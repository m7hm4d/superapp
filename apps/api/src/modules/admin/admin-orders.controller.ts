import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { OrderStatus, Role, zAdminOrdersQuery, zCancelOrder, zUuid } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminService, type AdminOrdersQuery } from './admin.service';
import { AuditService, type RequestWithId } from './audit.service';

type CancelOrderBody = z.infer<typeof zCancelOrder>;

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminOrdersController {
  constructor(
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get('orders')
  list(@Query(new ZodValidationPipe(zAdminOrdersQuery)) query: AdminOrdersQuery) {
    return this.adminService.listOrders(query);
  }

  @Get('stuck-orders')
  stuck() {
    return this.adminService.stuckOrders();
  }

  @Post('orders/:id/cancel')
  async cancel(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zCancelOrder)) body: CancelOrderBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const updated = await this.adminService.cancelOrder(id, user.id, body.reason);
    await this.audit.log(
      user.id,
      'force_cancel_order',
      'order',
      id,
      { to: OrderStatus.CANCELLED },
      body.reason,
      req.id,
    );
    return updated;
  }
}
