import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateOrderRequest,
  type CreateOrderResponse,
  type OrderResponse,
} from '@ticketflow/contracts';
import {
  cancelOrder,
  findBuyerOrder,
  type PaymentGateway,
  placeOrder,
  startCheckout,
  type UnitOfWork,
} from '@ticketflow/domain';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';
import { PAYMENT_GATEWAY } from '../payments/payments.module';

import { toOrderResponse } from './orders.mapper';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';
import { orderRequestHash } from './request-hash';

export interface CreatedOrder {
  order: CreateOrderResponse;
  /** A mesma Idempotency-Key já tinha criado este pedido. */
  replayed: boolean;
}

/**
 * Pedidos do comprador. As regras ficam em packages/domain (`placeOrder`, `startCheckout`,
 * `cancelOrder`, `findBuyerOrder`).
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaUnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * Reserva o estoque e grava o pedido numa transação; depois do commit, abre a Checkout
   * Session (ARCHITECTURE.md, seção 5, passos 1 e 2). O replay da mesma chave passa pelo
   * mesmo caminho: devolve a sessão que já existe ou cria a que faltou.
   */
  async create(
    userId: string,
    request: CreateOrderRequest,
    idempotencyKey?: string,
    now = new Date(),
  ): Promise<CreatedOrder> {
    const placed = await placeOrder(
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
    const { order, checkoutUrl } = await startCheckout(this.uow, this.payments, placed.order);
    return { order: { ...toOrderResponse(order), checkoutUrl }, replayed: placed.replayed };
  }

  async findOne(userId: string, orderId: string): Promise<OrderResponse> {
    return toOrderResponse(await findBuyerOrder(this.uow, { orderId, userId }));
  }

  async cancel(userId: string, orderId: string): Promise<OrderResponse> {
    const order = await cancelOrder(this.uow, this.payments, { orderId, userId });
    return toOrderResponse(order);
  }
}
