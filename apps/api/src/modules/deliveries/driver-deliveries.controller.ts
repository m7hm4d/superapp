import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role, zConfirmDelivery, zReportException } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DriversService } from './drivers.service';
import type { DriverBatchView } from './drivers.service';

type ConfirmDeliveryDto = z.infer<typeof zConfirmDelivery>;
type ReportExceptionDto = z.infer<typeof zReportException>;

/** تسليم الطلبات داخل الدفعة النشطة + تسجيل الاستثناءات */
@Controller('driver/orders')
@Roles(Role.DRIVER)
export class DriverDeliveriesController {
  constructor(private readonly driversService: DriversService) {}

  @Post(':orderId/deliver')
  deliver(
    @CurrentUser() user: RequestUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodValidationPipe(zConfirmDelivery)) body: ConfirmDeliveryDto,
  ): Promise<DriverBatchView> {
    return this.driversService.deliverOrder(user.id, orderId, body);
  }

  @Post(':orderId/exception')
  reportException(
    @CurrentUser() user: RequestUser,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body(new ZodValidationPipe(zReportException)) body: ReportExceptionDto,
  ): Promise<{ exceptionId: string; batch: DriverBatchView }> {
    return this.driversService.reportException(user.id, orderId, body);
  }
}
