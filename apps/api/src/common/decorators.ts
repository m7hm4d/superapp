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
 * النطاقات المحدودة التي يقبلها هذا المسار **بالاسم**.
 *
 * كانت هذه القيمة منطقية (`true`) فكان الحارس يكتفي بوجود `scope` أياً كانت
 * قيمته. النتيجة أن توكن الخطوة الثانية — الصادر بكلمة المرور وحدها — كان
 * يفتح مساري تسجيل TOTP ومفتاح المرور، فيسجّل المهاجم عاملاً ثانياً لنفسه
 * ويحصل على جلسة كاملة. الاسم الصريح يغلق ذلك: لكل نطاق مساراته وحدها.
 */
export const ALLOWED_SCOPES_KEY = 'allowedTokenScopes';
export const AllowScopes = (...scopes: string[]) => SetMetadata(ALLOWED_SCOPES_KEY, scopes);

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
