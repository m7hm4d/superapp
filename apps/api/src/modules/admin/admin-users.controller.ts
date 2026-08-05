import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { Role, UserStatus, zRejectDecision, zUuid } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminService, zAdminUsersQuery, type AdminUsersQuery } from './admin.service';
import { AuditService, type RequestWithId } from './audit.service';

/** الحظر/فك الحظر يتطلبان سبباً موثقاً — نفس شكل zRejectDecision */
type ReasonBody = z.infer<typeof zRejectDecision>;

@Roles(Role.ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(zAdminUsersQuery)) query: AdminUsersQuery) {
    return this.adminService.listUsers(query);
  }

  @Patch(':id/block')
  async block(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zRejectDecision)) body: ReasonBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const row = await this.adminService.setUserStatus(id, UserStatus.BLOCKED);
    await this.audit.log(
      user.id,
      'block_user',
      'user',
      id,
      { status: UserStatus.BLOCKED },
      body.reason,
      req.id,
    );
    return row;
  }

  @Patch(':id/unblock')
  async unblock(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zRejectDecision)) body: ReasonBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const row = await this.adminService.setUserStatus(id, UserStatus.ACTIVE);
    await this.audit.log(
      user.id,
      'unblock_user',
      'user',
      id,
      { status: UserStatus.ACTIVE },
      body.reason,
      req.id,
    );
    return row;
  }
}
