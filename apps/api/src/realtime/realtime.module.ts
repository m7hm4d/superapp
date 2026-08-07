import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { VendorsModule } from '../modules/vendors/vendors.module';
import { EventsPublisher } from './events.publisher';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({}), VendorsModule],
  providers: [RealtimeGateway, EventsPublisher],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
