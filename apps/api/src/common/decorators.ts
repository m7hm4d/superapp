import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@superapp/shared';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** يتخطى ApprovedGuard لمسارات مسموحة أثناء "قيد المراجعة" (الملف M-01/D-01) */
export const SKIP_APPROVAL_KEY = 'skipApproval';
export const SkipApproval = () => SetMetadata(SKIP_APPROVAL_KEY, true);

/**
 * يقبل توكن تسجيل TOTP المحدود إضافةً إلى توكن الجلسة الكامل.
 * حصراً لمساري إعداد/تفعيل TOTP — أي مسار آخر يرفض التوكن المحدود.
 */
export const ALLOW_TOTP_ENROLLMENT_KEY = 'allowTotpEnrollment';
export const AllowTotpEnrollment = () => SetMetadata(ALLOW_TOTP_ENROLLMENT_KEY, true);

export interface RequestUser {
  id: string;
  role: Role;
  phone: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);
