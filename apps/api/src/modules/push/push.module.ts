import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushSubscriber } from './push.subscriber';

@Module({
  imports: [VendorsModule],
  controllers: [PushController],
  providers: [PushService, PushSubscriber],
  exports: [PushService],
})
export class PushModule {}
