import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role, zConfirmPickup } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DriversService } from './drivers.service';
import type { DriverBatchView } from './drivers.service';

type ConfirmPickupDto = z.infer<typeof zConfirmPickup>;

/** دفعات السائق: العروض، المطالبة الذرية، تأكيد الاستلام، الدفعة النشطة */
@Controller('driver/batches')
@Roles(Role.DRIVER)
export class DriverBatchesController {
  constructor(private readonly driversService: DriversService) {}

  @Get('available')
  listAvailable(@CurrentUser() user: RequestUser): Promise<DriverBatchView[]> {
    return this.driversService.listAvailableBatches(user.id);
  }

  @Get('active')
  getActive(@CurrentUser() user: RequestUser): Promise<DriverBatchView | null> {
    return this.driversService.getActiveBatch(user.id);
  }

  @Post(':id/claim')
  claim(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DriverBatchView> {
    return this.driversService.claimBatch(user.id, id);
  }

  @Post(':id/confirm-pickup')
  confirmPickup(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zConfirmPickup)) body: ConfirmPickupDto,
  ): Promise<DriverBatchView> {
    return this.driversService.confirmPickup(user.id, id, body.pin);
  }
}
