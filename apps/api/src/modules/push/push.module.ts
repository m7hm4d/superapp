import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { PushSubscriber } from './push.subscriber';

@Module({
  controllers: [PushController],
  providers: [PushService, PushSubscriber],
  exports: [PushService],
})
export class PushModule {}
