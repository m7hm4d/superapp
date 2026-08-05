import { Controller, Get, Param, Query } from '@nestjs/common';
import { NearbyQuery, VendorCardView, zNearbyQuery, zUuid } from '@superapp/shared';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { VendorPublicView, VendorsService } from './vendors.service';

/** تصفح العميل — متاح للضيوف */
@Public()
@Controller('vendors')
export class VendorsPublicController {
  constructor(private readonly vendors: VendorsService) {}

  @Get('nearby')
  nearby(@Query(new ZodValidationPipe(zNearbyQuery)) query: NearbyQuery): Promise<VendorCardView[]> {
    return this.vendors.findNearby(query);
  }

  @Get(':id')
  getOne(@Param('id', new ZodValidationPipe(zUuid)) id: string): Promise<VendorPublicView> {
    return this.vendors.getPublicVendor(id);
  }
}
