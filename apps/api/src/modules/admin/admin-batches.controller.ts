import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { BatchStatus, Role, zUuid } from '@superapp/shared';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AuditService, type RequestWithId } from './audit.service';
import {
  OpsService,
  zAdminBatchesQuery,
  zCancelBatch,
  type AdminBatchesQuery,
  type CancelBatchInput,
} from './ops.service';

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminBatchesController {
  constructor(
    private readonly ops: OpsService,
    private readonly audit: AuditService,
  ) {}

  @Get('batches')
  list(@Query(new ZodValidationPipe(zAdminBatchesQuery)) query: AdminBatchesQuery) {
    return this.ops.listBatches(query);
  }

  @Post('batches/:id/cancel')
  async cancel(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zCancelBatch)) body: CancelBatchInput,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const result = await this.ops.cancelBatch(id, user.id, body.reason);
    await this.audit.log(
      user.id,
      'cancel_batch',
      'batch',
      id,
      { to: BatchStatus.CANCELLED, releasedOrderIds: result.releasedOrderIds },
      body.reason,
      req.id,
    );
    return result;
  }
}
