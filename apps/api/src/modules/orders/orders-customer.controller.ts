import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Role, zCancelOrder, zCreateOrder } from '@superapp/shared';
import type { CreateOrderInput, OrderView } from '@superapp/shared';
import type { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { OrdersService } from './orders.service';

type CancelOrderDto = z.infer<typeof zCancelOrder>;

@Controller('orders')
@Roles(Role.CUSTOMER)
export class OrdersCustomerController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zCreateOrder)) input: CreateOrderInput,
  ): Promise<OrderView> {
    return this.ordersService.createOrder(user.id, input);
  }

  @Get()
  listMyOrders(@CurrentUser() user: RequestUser): Promise<OrderView[]> {
    return this.ordersService.listCustomerOrders(user.id);
  }

  @Get(':id')
  getMyOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderView> {
    return this.ordersService.getCustomerOrder(user.id, id);
  }

  @Post(':id/cancel')
  cancelMyOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zCancelOrder)) body: CancelOrderDto,
  ): Promise<OrderView> {
    return this.ordersService.cancelByCustomer(user.id, id, body.reason);
  }
}
