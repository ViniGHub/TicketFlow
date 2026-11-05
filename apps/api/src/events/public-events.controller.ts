import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  type EventResponse,
  eventResponseSchema,
  type EventSummaryResponse,
  eventSummaryPageSchema,
  type ListEventsQuery,
  listEventsQuerySchema,
  type Page,
} from '@ticketflow/contracts';

import { openApiSchema, uuidParamPipe, ZodValidationPipe } from '../common/validation';

import { EventsService } from './events.service';
import { cursorQueryDocs, dateTimeQueryDocs, limitQueryDocs } from './query-docs';

/** Catálogo público: só eventos publicados, sem login. */
@ApiTags('events')
@Controller('events')
export class PublicEventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiQuery(dateTimeQueryDocs('from', 'Início do intervalo, com fuso. Padrão: agora.'))
  @ApiQuery(dateTimeQueryDocs('to', 'Fim do intervalo (exclusivo), com fuso.'))
  @ApiQuery(cursorQueryDocs)
  @ApiQuery(limitQueryDocs)
  @ApiOkResponse({
    description: 'Eventos publicados, em ordem de data.',
    schema: openApiSchema(eventSummaryPageSchema, 'output'),
  })
  list(
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsQuery,
  ): Promise<Page<EventSummaryResponse>> {
    return this.events.listPublished(query);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Evento publicado, com os lotes e a disponibilidade.',
    schema: openApiSchema(eventResponseSchema, 'output'),
  })
  detail(@Param('id', uuidParamPipe) eventId: string): Promise<EventResponse> {
    return this.events.getPublished(eventId);
  }
}
