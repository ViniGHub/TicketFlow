import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { type Request } from 'express';

import { StripeWebhookService } from './stripe-webhook.service';

/**
 * `POST /webhooks/stripe`. Sem login nem rate limit: quem autentica é a assinatura. Fora do
 * Swagger, porque uma chamada de lá nunca teria assinatura válida.
 */
@ApiExcludeController()
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  /** 200 para evento processado, repetido ou ignorado; 400 sem assinatura válida; 5xx em erro. */
  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  async stripe(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: true }> {
    await this.webhooks.handle(request.rawBody, signature);
    return { received: true };
  }
}
