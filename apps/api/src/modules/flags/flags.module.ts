import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { FlagsService } from './flags.service';

@Module({
  controllers: [ConfigController],
  providers: [FlagsService],
  exports: [FlagsService],
})
export class FlagsModule {}
