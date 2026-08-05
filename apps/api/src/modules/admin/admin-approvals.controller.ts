import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApprovalStatus,
  Role,
  zApprovalDecision,
  zApprovalsQuery,
  zRejectDecision,
  zUuid,
} from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminService, type ApprovalType, type ApprovalsQuery } from './admin.service';
import { AuditService, type RequestWithId } from './audit.service';

const zApprovalType = z.enum([Role.VENDOR, Role.DRIVER]);

type ApprovalDecisionBody = z.infer<typeof zApprovalDecision>;
type RejectDecisionBody = z.infer<typeof zRejectDecision>;

@Roles(Role.ADMIN)
@Controller('admin/approvals')
export class AdminApprovalsController {
  constructor(
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query(new ZodValidationPipe(zApprovalsQuery)) query: ApprovalsQuery) {
    return this.adminService.listApprovals(query);
  }

  @Post(':type/:profileId/approve')
  async approve(
    @Param('type', new ZodValidationPipe(zApprovalType)) type: ApprovalType,
    @Param('profileId', new ZodValidationPipe(zUuid)) profileId: string,
    @Body(new ZodValidationPipe(zApprovalDecision)) body: ApprovalDecisionBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const row = await this.adminService.decideApproval(
      type,
      profileId,
      ApprovalStatus.APPROVED,
      body.reason,
    );
    await this.audit.log(
      user.id,
      `approve_${type}`,
      `${type}_profile`,
      profileId,
      { approvalStatus: ApprovalStatus.APPROVED },
      body.reason,
      req.id,
    );
    return row;
  }

  @Post(':type/:profileId/reject')
  async reject(
    @Param('type', new ZodValidationPipe(zApprovalType)) type: ApprovalType,
    @Param('profileId', new ZodValidationPipe(zUuid)) profileId: string,
    @Body(new ZodValidationPipe(zRejectDecision)) body: RejectDecisionBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const row = await this.adminService.decideApproval(
      type,
      profileId,
      ApprovalStatus.REJECTED,
      body.reason,
    );
    await this.audit.log(
      user.id,
      `reject_${type}`,
      `${type}_profile`,
      profileId,
      { approvalStatus: ApprovalStatus.REJECTED },
      body.reason,
      req.id,
    );
    return row;
  }
}
