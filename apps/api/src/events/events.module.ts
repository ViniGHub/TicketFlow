import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { EventSalesService } from './event-sales.service';
import { EventsService } from './events.service';
import { MyEventsController, OrganizerEventsController } from './organizer-events.controller';
import { PublicEventsController } from './public-events.controller';
import { TicketTypesService } from './ticket-types.service';

@Module({
  imports: [AuthModule],
  controllers: [PublicEventsController, OrganizerEventsController, MyEventsController],
  providers: [EventsService, TicketTypesService, EventSalesService],
})
export class EventsModule {}
