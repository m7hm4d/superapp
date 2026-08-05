import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsPublisher } from './events.publisher';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, EventsPublisher],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
