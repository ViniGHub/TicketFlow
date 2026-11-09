import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  type CheckInRequest,
  checkInRequestSchema,
  type CheckInResponse,
  checkInResponseSchema,
  myTicketPageSchema,
  type MyTicketResponse,
  type MyTicketsQuery,
  myTicketsQuerySchema,
  type Page,
} from '@ticketflow/contracts';

import {
  type AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../auth/auth.guards';
import { openApiSchema, uuidParamPipe, ZodValidationPipe } from '../common/validation';
import { cursorQueryDocs, limitQueryDocs } from '../events/query-docs';

import { TicketsService } from './tickets.service';

/** Ingressos do comprador, com o `qrToken` que ele apresenta na entrada. */
@ApiTags('tickets')
@ApiCookieAuth()
@Controller('me/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('BUYER')
export class MyTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  @ApiQuery(cursorQueryDocs)
  @ApiQuery(limitQueryDocs)
  @ApiOkResponse({
    description: 'Ingressos do comprador (válidos, usados e anulados), os mais novos primeiro.',
    schema: openApiSchema(myTicketPageSchema, 'output'),
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(myTicketsQuerySchema)) query: MyTicketsQuery,
  ): Promise<Page<MyTicketResponse>> {
    return this.tickets.listMine(user.id, query);
  }
}

/** Check-in na entrada, pelo organizador dono do evento (ARCHITECTURE.md, seção 9). */
@ApiTags('tickets')
@ApiCookieAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ORGANIZER')
export class CheckInController {
  constructor(private readonly tickets: TicketsService) {}

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ schema: openApiSchema(checkInRequestSchema) })
  @ApiOkResponse({
    description: 'Ingresso válido: a entrada fica registrada e não vale de novo.',
    schema: openApiSchema(checkInResponseSchema, 'output'),
  })
  @ApiNotFoundResponse({
    description: 'Evento de outro organizador (EVENT_NOT_FOUND) ou ingresso inexistente.',
  })
  @ApiConflictResponse({ description: 'Ingresso já utilizado ou cancelado por reembolso.' })
  @ApiUnprocessableEntityResponse({ description: 'Ingresso de outro evento.' })
  checkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
    @Body(new ZodValidationPipe(checkInRequestSchema)) body: CheckInRequest,
  ): Promise<CheckInResponse> {
    return this.tickets.checkIn(user.id, eventId, body.qrToken);
  }
}
