import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { VendorSelfController } from './vendor-self.controller';
import { VendorsPublicController } from './vendors-public.controller';
import { VendorsService } from './vendors.service';

@Module({
  controllers: [VendorsPublicController, VendorSelfController],
  providers: [VendorsService, ProductsService],
  exports: [VendorsService],
})
export class VendorsModule {}
