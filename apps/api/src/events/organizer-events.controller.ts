import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateEventRequest,
  createEventRequestSchema,
  type CreateTicketTypeRequest,
  createTicketTypeRequestSchema,
  type EventResponse,
  eventResponseSchema,
  type TicketTypeResponse,
  ticketTypeResponseSchema,
  type UpdateEventRequest,
  updateEventRequestSchema,
  type UpdateTicketTypeRequest,
  updateTicketTypeRequestSchema,
} from '@ticketflow/contracts';

import {
  type AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../auth/auth.guards';
import { openApiSchema, uuidParamPipe, ZodValidationPipe } from '../common/validation';

import { EventsService } from './events.service';
import { TicketTypesService } from './ticket-types.service';

const eventSchema = openApiSchema(eventResponseSchema, 'output');
const ticketTypeSchema = openApiSchema(ticketTypeResponseSchema, 'output');

/**
 * Gestão do catálogo pelo organizador. Sem o papel ORGANIZER: 403. Evento de outro
 * organizador: 404, como se não existisse.
 */
@ApiTags('events')
@ApiCookieAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ORGANIZER')
export class OrganizerEventsController {
  constructor(
    private readonly events: EventsService,
    private readonly ticketTypes: TicketTypesService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ schema: openApiSchema(createEventRequestSchema) })
  @ApiCreatedResponse({ description: 'Evento criado como rascunho.', schema: eventSchema })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEventRequestSchema)) body: CreateEventRequest,
  ): Promise<EventResponse> {
    return this.events.create(user.id, body);
  }

  @Patch(':id')
  @ApiBody({ schema: openApiSchema(updateEventRequestSchema) })
  @ApiOkResponse({ description: 'Evento atualizado.', schema: eventSchema })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
    @Body(new ZodValidationPipe(updateEventRequestSchema)) body: UpdateEventRequest,
  ): Promise<EventResponse> {
    return this.events.update(user.id, eventId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Rascunho excluído, com os lotes.' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
  ): Promise<void> {
    return this.events.remove(user.id, eventId);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    description: 'Evento publicado (idempotente: já publicado não muda).',
    schema: eventSchema,
  })
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
  ): Promise<EventResponse> {
    return this.events.publish(user.id, eventId);
  }

  @Post(':id/ticket-types')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ schema: openApiSchema(createTicketTypeRequestSchema) })
  @ApiCreatedResponse({
    description: 'Lote criado, com todo o estoque disponível.',
    schema: ticketTypeSchema,
  })
  createTicketType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
    @Body(new ZodValidationPipe(createTicketTypeRequestSchema)) body: CreateTicketTypeRequest,
  ): Promise<TicketTypeResponse> {
    return this.ticketTypes.create(user.id, eventId, body);
  }

  @Patch(':id/ticket-types/:ticketTypeId')
  @ApiBody({ schema: openApiSchema(updateTicketTypeRequestSchema) })
  @ApiOkResponse({
    description: 'Lote atualizado. Reduzir o total abaixo do vendido responde 409.',
    schema: ticketTypeSchema,
  })
  updateTicketType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParamPipe) eventId: string,
    @Param('ticketTypeId', uuidParamPipe) ticketTypeId: string,
    @Body(new ZodValidationPipe(updateTicketTypeRequestSchema)) body: UpdateTicketTypeRequest,
  ): Promise<TicketTypeResponse> {
    return this.ticketTypes.update(user.id, eventId, ticketTypeId, body);
  }
}
