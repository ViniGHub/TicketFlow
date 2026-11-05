import { Inject, Injectable } from '@nestjs/common';
import { type CreateOrderRequest, type OrderResponse } from '@ticketflow/contracts';
import { cancelOrder, placeOrder, type SessionExpirer, type UnitOfWork } from '@ticketflow/domain';

import { type ApiEnv } from '../config/env';
import { API_ENV } from '../config/env.token';

import { toOrderResponse } from './orders.mapper';
import { PrismaUnitOfWork } from './persistence/prisma-unit-of-work';
import { orderRequestHash } from './request-hash';
import { SESSION_EXPIRER } from './session-expirer';

export interface CreatedOrder {
  order: OrderResponse;
  /** A mesma Idempotency-Key já tinha criado este pedido. */
  replayed: boolean;
}

/** Pedidos do comprador. As regras ficam em packages/domain (`placeOrder`, `cancelOrder`). */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaUnitOfWork) private readonly uow: UnitOfWork,
    @Inject(SESSION_EXPIRER) private readonly sessionExpirer: SessionExpirer,
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

  async cancel(userId: string, orderId: string): Promise<OrderResponse> {
    const order = await cancelOrder(this.uow, this.sessionExpirer, { orderId, userId });
    return toOrderResponse(order);
  }
}
