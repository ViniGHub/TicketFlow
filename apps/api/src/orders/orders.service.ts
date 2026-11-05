import { Inject, Injectable } from '@nestjs/common';
import { type CreateOrderRequest, type OrderResponse } from '@ticketflow/contracts';
import { placeOrder, type UnitOfWork } from '@ticketflow/domain';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

import { toOrderResponse } from './orders.mapper';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';
import { orderRequestHash } from './request-hash';

export interface CreatedOrder {
  order: OrderResponse;
  /** A mesma Idempotency-Key já tinha criado este pedido. */
  replayed: boolean;
}

/** Pedidos do comprador. A regra fica em `placeOrder` (packages/domain). */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaUnitOfWork) private readonly uow: UnitOfWork,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async create(
    userId: string,
    request: CreateOrderRequest,
    idempotencyKey?: string,
    now = new Date(),
  ): Promise<CreatedOrder> {
    const { order, replayed } = await placeOrder(
      this.uow,
      {
        userId,
        items: request.items,
        ...(idempotencyKey && {
          idempotency: { key: idempotencyKey, requestHash: orderRequestHash(request.items) },
        }),
      },
      { now, reservationTtlMinutes: this.env.RESERVATION_TTL_MINUTES },
    );
    return { order: toOrderResponse(order), replayed };
  }
}
