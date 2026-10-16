import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { truncateAllTables } from '@ticketflow/testing';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, EventStatus, Role } from './index.js';

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

// Códigos de erro do Postgres.
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const databaseUrl = inject('databaseUrl');
const prisma = createPrismaClient(databaseUrl);
// SQL cru para as violações: o erro do driver traz o código e o nome da constraint.
const sql = new pg.Pool({ connectionString: databaseUrl });

afterAll(async () => {
  await prisma.$disconnect();
  await sql.end();
});

beforeEach(async () => {
  await truncateAllTables(databaseUrl);
});

async function createUser(roles: Role[] = [Role.BUYER]) {
  return prisma.user.create({
    data: { email: `${randomUUID()}@test.local`, passwordHash: 'hash', name: 'Teste', roles },
  });
}

async function createTicketType(total = 10) {
  const organizer = await createUser([Role.ORGANIZER]);
  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      title: 'Evento',
      description: 'Descrição',
      venue: 'Local',
      timezone: 'America/Sao_Paulo',
      startsAt: new Date(Date.now() + 7 * DAY_MS),
      status: EventStatus.PUBLISHED,
    },
  });
  return prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'Pista',
      priceCents: 5_000,
      total,
      available: total,
      salesStart: new Date(Date.now() - DAY_MS),
      salesEnd: new Date(Date.now() + 6 * DAY_MS),
      maxPerOrder: 4,
    },
  });
}

async function createOrder(userId: string, idempotencyKey: string | null = null) {
  return prisma.order.create({
    data: { userId, totalCents: 0, idempotencyKey, expiresAt: new Date(Date.now() + DAY_MS) },
  });
}

describe('CHECK de estoque em ticket_types', () => {
  it('rejeita UPDATE que deixaria available < 0 e mantém o estoque', async () => {
    const ticketType = await createTicketType(10);

    await expect(
      sql.query('UPDATE ticket_types SET available = available - 11 WHERE id = $1', [
        ticketType.id,
      ]),
    ).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ticket_types_available_range_check',
    });

    const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketType.id } });
    expect(after.available).toBe(10);
  });

  it('rejeita UPDATE que deixaria available > total', async () => {
    const ticketType = await createTicketType(10);

    await expect(
      sql.query('UPDATE ticket_types SET available = available + 1 WHERE id = $1', [ticketType.id]),
    ).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ticket_types_available_range_check',
    });
  });

  it('aceita os limites available = 0 e available = total', async () => {
    const ticketType = await createTicketType(10);

    await sql.query('UPDATE ticket_types SET available = 0 WHERE id = $1', [ticketType.id]);
    await sql.query('UPDATE ticket_types SET available = total WHERE id = $1', [ticketType.id]);

    const after = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketType.id } });
    expect(after.available).toBe(10);
  });

  it('rejeita price_cents negativo', async () => {
    const ticketType = await createTicketType();

    await expect(
      sql.query('UPDATE ticket_types SET price_cents = -1 WHERE id = $1', [ticketType.id]),
    ).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'ticket_types_price_cents_check',
    });
  });
});

describe('order_items', () => {
  it('rejeita quantity <= 0', async () => {
    const ticketType = await createTicketType();
    const order = await createOrder((await createUser()).id);

    await expect(
      sql.query(
        `INSERT INTO order_items (id, order_id, ticket_type_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, 0, 5000)`,
        [randomUUID(), order.id, ticketType.id],
      ),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION, constraint: 'order_items_quantity_check' });
  });

  it('rejeita o mesmo lote duas vezes no mesmo pedido', async () => {
    const ticketType = await createTicketType();
    const order = await createOrder((await createUser()).id);
    const insert = () =>
      sql.query(
        `INSERT INTO order_items (id, order_id, ticket_type_id, quantity, unit_price_cents)
         VALUES ($1, $2, $3, 1, 5000)`,
        [randomUUID(), order.id, ticketType.id],
      );

    await insert();
    await expect(insert()).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'order_items_order_id_ticket_type_id_key',
    });
  });
});

describe('UNIQUE (user_id, idempotency_key) em orders', () => {
  it('rejeita a mesma chave para o mesmo usuário', async () => {
    const user = await createUser();
    await createOrder(user.id, 'chave-1');

    const duplicate = sql.query(
      `INSERT INTO orders (id, user_id, total_cents, idempotency_key, expires_at, updated_at)
       VALUES ($1, $2, 0, 'chave-1', now() + interval '1 day', now())`,
      [randomUUID(), user.id],
    );
    await expect(duplicate).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'orders_user_id_idempotency_key_key',
    });
  });

  it('aceita vários pedidos sem chave e a mesma chave em usuários diferentes', async () => {
    const [ana, bia] = await Promise.all([createUser(), createUser()]);

    await createOrder(ana.id);
    await createOrder(ana.id);
    await createOrder(ana.id, 'chave-compartilhada');
    await createOrder(bia.id, 'chave-compartilhada');

    expect(await prisma.order.count()).toBe(4);
  });
});

describe('stripe_events', () => {
  it('rejeita o mesmo event_id duas vezes', async () => {
    const insert = () =>
      sql.query(`INSERT INTO stripe_events (event_id, type) VALUES ('evt_123', 'x')`);

    await insert();
    await expect(insert()).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'stripe_events_pkey',
    });
  });
});

describe('índices parciais', () => {
  async function indexDefinition(name: string): Promise<string | undefined> {
    const { rows } = await sql.query<{ indexdef: string }>(
      'SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = $2',
      ['public', name],
    );
    return rows[0]?.indexdef;
  }

  it('orders(expires_at) só para pedidos PENDING', async () => {
    expect(await indexDefinition('orders_expires_at_pending_idx')).toMatch(
      /ON public\.orders .*\(expires_at\) WHERE \(status = 'PENDING'::order_status\)$/,
    );
  });

  it('outbox(created_at) só para linhas não publicadas', async () => {
    expect(await indexDefinition('outbox_created_at_unpublished_idx')).toMatch(
      /ON public\.outbox .*\(created_at\) WHERE \(published_at IS NULL\)$/,
    );
  });
});

describe('migrations', () => {
  it('batem com o schema.prisma (sem drift)', async () => {
    const packageDir = fileURLToPath(new URL('..', import.meta.url));

    // --exit-code: sai com 2 se houver diferença entre o banco migrado e o schema.
    const result = execFileAsync(
      'pnpm',
      [
        'exec',
        'prisma',
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: packageDir,
        env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
        // No Windows, `pnpm` é um .cmd e só roda via shell. Os argumentos são fixos.
        shell: process.platform === 'win32',
      },
    );

    await expect(result).resolves.toBeDefined();
  });
});
