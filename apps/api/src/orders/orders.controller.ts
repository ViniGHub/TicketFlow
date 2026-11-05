import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type CreateOrderRequest,
  createOrderRequestSchema,
  idempotencyKeySchema,
  ORDER_LIMITS,
  type OrderResponse,
  orderResponseSchema,
} from '@ticketflow/contracts';
import { type Response } from 'express';

import {
  type AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../auth/auth.guards';
import { openApiSchema, uuidParamPipe, ZodValidationPipe } from '../common/validation';
import { UserThrottlerGuard } from '../security/user-throttler.guard';

import { IDEMPOTENCY_HEADER, IdempotencyKeyHeader } from './idempotency-key.decorator';
import { OrdersService } from './orders.service';

const ONE_MINUTE_MS = 60_000;
const orderSchema = openApiSchema(orderResponseSchema, 'output');

@ApiTags('orders')
@ApiCookieAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard, UserThrottlerGuard)
@Roles('BUYER')
@Throttle({ default: { limit: 20, ttl: ONE_MINUTE_MS } })
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: false,
    description:
      `Uma chave por tentativa de compra (até ${ORDER_LIMITS.maxIdempotencyKeyLength} ` +
      'caracteres ASCII visíveis). Repetida com o mesmo corpo, devolve o pedido já criado ' +
      'com o header `Idempotent-Replayed: true`; com outro corpo, 422.',
  })
  @ApiBody({ schema: openApiSchema(createOrderRequestSchema) })
  @ApiCreatedResponse({
    description: 'Pedido PENDING com o estoque reservado até `expiresAt`.',
    schema: orderSchema,
  })
  @ApiConflictResponse({
    description: 'Sem estoque, vendas fechadas ou evento fora de venda.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Acima do limite por pedido do lote, total grande demais ou chave repetida.',
  })
  @ApiTooManyRequestsResponse({ description: 'Mais de 20 pedidos por minuto deste usuário.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderRequestSchema)) body: CreateOrderRequest,
    @IdempotencyKeyHeader(new ZodValidationPipe(idempotencyKeySchema, IDEMPOTENCY_HEADER))
    idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrderResponse> {
    const { order, replayed } = await this.orders.create(user.id, body, idempotencyKey);
    if (replayed) {
      response.setHeader('Idempotent-Replayed', 'true');
    }
    return order;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Pedido CANCELLED; o estoque voltou ao lote.',
    schema: orderSchema,
  })
  @ApiNotFoundResponse({ description: 'Pedido inexistente ou de outro comprador.' })
  @ApiConflictResponse({
    description: 'O pedido não está aguardando pagamento, ou o pagamento já foi concluído.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) orderId: string,
  ): Promise<OrderResponse> {
    return this.orders.cancel(user.id, orderId);
  }
}
