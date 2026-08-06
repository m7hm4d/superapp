import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role, zAcceptOrder, zCancelOrder, zMarkReady, zRejectOrder } from '@superapp/shared';
import type { OrderView } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { OrdersService } from './orders.service';

/** قوائم شاشة البائع: جديد | قيد التحضير | جاهز | السجل */
const zVendorOrdersQuery = z.object({
  status: z.enum(['new', 'preparing', 'ready', 'history']).default('new'),
});

type VendorOrdersQuery = z.infer<typeof zVendorOrdersQuery>;
type AcceptOrderDto = z.infer<typeof zAcceptOrder>;
type RejectOrderDto = z.infer<typeof zRejectOrder>;
type MarkReadyDto = z.infer<typeof zMarkReady>;
type CancelOrderDto = z.infer<typeof zCancelOrder>;

@Controller('vendor/orders')
@Roles(Role.VENDOR)
export class OrdersVendorController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  listOrders(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(zVendorOrdersQuery)) query: VendorOrdersQuery,
  ): Promise<OrderView[]> {
    return this.ordersService.listVendorOrders(user.id, query.status);
  }

  @Post(':id/accept')
  acceptOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zAcceptOrder)) body: AcceptOrderDto,
  ): Promise<OrderView> {
    return this.ordersService.acceptByVendor(user.id, id, body);
  }

  @Post(':id/reject')
  rejectOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zRejectOrder)) body: RejectOrderDto,
  ): Promise<OrderView> {
    return this.ordersService.rejectByVendor(user.id, id, body);
  }

  @Post(':id/ready')
  markReady(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zMarkReady)) body: MarkReadyDto,
  ): Promise<OrderView> {
    return this.ordersService.markReadyByVendor(user.id, id, body);
  }

  @Post(':id/cancel')
  cancelOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zCancelOrder)) body: CancelOrderDto,
  ): Promise<OrderView> {
    return this.ordersService.cancelByVendor(user.id, id, body.reason);
  }
}
