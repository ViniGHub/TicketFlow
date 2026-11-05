import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { EventsService } from './events.service';
import { OrganizerEventsController } from './organizer-events.controller';
import { TicketTypesService } from './ticket-types.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizerEventsController],
  providers: [EventsService, TicketTypesService],
})
export class EventsModule {}
