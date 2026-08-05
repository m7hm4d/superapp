import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Role, zPagination, zUuid } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { authEvents } from '../../db/schema';
import { AuthEventsService } from '../auth/auth-events.service';
import { TokenService } from '../auth/token.service';
import { AuditService, type RequestWithId } from './audit.service';

export const zAuthEventsQuery = z
  .object({
    userId: zUuid.optional(),
    outcome: z.enum(authEvents.outcome.enumValues).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .merge(zPagination);
type AuthEventsQuery = z.infer<typeof zAuthEventsQuery>;

export const zSessionsQuery = z.object({ userId: zUuid.optional() }).merge(zPagination);
type SessionsQuery = z.infer<typeof zSessionsQuery>;

/**
 * الأمان: سجل عمليات الدخول والجلسات النشطة (A-07).
 * قطع الجلسة يُبطل سلالة refresh كاملة — الوصول ينتهي عند انتهاء access
 * الحالي (15 دقيقة) على أبعد تقدير.
 */
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminSecurityController {
  constructor(
    private readonly events: AuthEventsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  @Get('auth-events')
  authEvents(@Query(new ZodValidationPipe(zAuthEventsQuery)) query: AuthEventsQuery) {
    return this.events.listEvents(query);
  }

  @Get('auth-events/summary')
  summary() {
    return this.events.summary();
  }

  @Get('sessions')
  sessions(@Query(new ZodValidationPipe(zSessionsQuery)) query: SessionsQuery) {
    return this.events.listActiveSessions(query);
  }

  @HttpCode(200)
  @Post('sessions/:familyId/revoke')
  async revokeSession(
    @Param('familyId', new ZodValidationPipe(zUuid)) familyId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const owner = await this.events.sessionOwner(familyId);
    await this.tokens.revokeFamily(familyId);
    await this.events.record({
      userId: owner?.userId ?? null,
      method: 'admin_action',
      outcome: 'session_revoked',
      sessionFamilyId: familyId,
      requestId: req.id ?? null,
    });
    await this.audit.log(
      user.id,
      'revoke_session',
      'session',
      familyId,
      { ownerUserId: owner?.userId ?? null, ownerName: owner?.fullName ?? null },
      undefined,
      req.id,
    );
    return { ok: true };
  }
}
