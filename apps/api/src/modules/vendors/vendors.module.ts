import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { VendorDirectoryService } from './vendor-directory.service';
import { VendorSelfController } from './vendor-self.controller';
import { VendorsPublicController } from './vendors-public.controller';
import { VendorsService } from './vendors.service';

/**
 * `VendorDirectoryService` منفذ القراءة الذي تناديه الوحدات الأخرى بدل
 * الاستعلام عن `vendorProfiles` مباشرة — انظر docs/module-boundaries.md.
 */
@Module({
  controllers: [VendorsPublicController, VendorSelfController],
  providers: [VendorsService, ProductsService, VendorDirectoryService],
  exports: [VendorsService, VendorDirectoryService],
})
export class VendorsModule {}
