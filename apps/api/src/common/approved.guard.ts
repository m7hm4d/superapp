import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApprovalStatus, Role } from '@superapp/shared';
import { eq } from 'drizzle-orm';
import { DB, DbClient } from '../db/drizzle.module';
import { driverProfiles, vendorProfiles } from '../db/schema';
import { SKIP_APPROVAL_KEY } from './decorators';

/**
 * البائع/السائق غير الموافَق عليه يصله 403 PENDING_APPROVAL على مسارات العمل،
 * فيعرض التطبيق شاشة "قيد المراجعة" (M-01/D-01) مع بقاء الدخول والملف متاحين.
 */
@Injectable()
export class ApprovedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: DbClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_APPROVAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return true;
    if (user.role !== Role.VENDOR && user.role !== Role.DRIVER) return true;

    const table = user.role === Role.VENDOR ? vendorProfiles : driverProfiles;
    const [profile] = await this.db
      .select({ approvalStatus: table.approvalStatus, rejectionReason: table.rejectionReason })
      .from(table)
      .where(eq(table.userId, user.id))
      .limit(1);

    if (!profile || profile.approvalStatus !== ApprovalStatus.APPROVED) {
      throw new ForbiddenException({
        code: 'PENDING_APPROVAL',
        approvalStatus: profile?.approvalStatus ?? 'missing',
        reason: profile?.rejectionReason ?? null,
      });
    }
    return true;
  }
}
