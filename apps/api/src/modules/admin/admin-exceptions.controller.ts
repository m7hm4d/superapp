import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role, zResolveException, zUuid } from '@superapp/shared';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AuditService, type RequestWithId } from './audit.service';
import {
  OpsService,
  zAdminExceptionsQuery,
  type AdminExceptionsQuery,
  type ResolveExceptionInput,
} from './ops.service';

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminExceptionsController {
  constructor(
    private readonly ops: OpsService,
    private readonly audit: AuditService,
  ) {}

  @Get('exceptions')
  list(@Query(new ZodValidationPipe(zAdminExceptionsQuery)) query: AdminExceptionsQuery) {
    return this.ops.listExceptions(query);
  }

  @Post('exceptions/:id/resolve')
  async resolve(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zResolveException)) body: ResolveExceptionInput,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const result = await this.ops.resolveException(id, user.id, body);
    await this.audit.log(
      user.id,
      'resolve_exception',
      'exception',
      id,
      { decision: body.decision, orderId: result.exception.orderId },
      body.reason,
      req.id,
    );
    return result;
  }
}
