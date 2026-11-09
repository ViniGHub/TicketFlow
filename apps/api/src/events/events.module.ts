import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';

import { EventSalesService } from './event-sales.service';
import { EventsService } from './events.service';
import { MyEventsController, OrganizerEventsController } from './organizer-events.controller';
import { PublicEventsController } from './public-events.controller';
import { TicketTypesService } from './ticket-types.service';

@Module({
  // OrdersModule: a unidade de trabalho do domínio, para o cancelamento do evento.
  imports: [AuthModule, OrdersModule],
  controllers: [PublicEventsController, OrganizerEventsController, MyEventsController],
  providers: [EventsService, TicketTypesService, EventSalesService],
})
export class EventsModule {}
