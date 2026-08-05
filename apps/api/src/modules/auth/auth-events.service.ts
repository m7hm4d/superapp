import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { authEvents, refreshTokens, users } from '../../db/schema';

export type AuthEventMethod = (typeof authEvents.method.enumValues)[number];
export type AuthEventOutcome = (typeof authEvents.outcome.enumValues)[number];

/** ما يُلتقط من الطلب لتمييز الجهاز ومصدره — يُمرَّر من المتحكم */
export interface AuthContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface RecordAuthEventArgs extends AuthContext {
  userId?: string | null;
  method: AuthEventMethod;
  outcome: AuthEventOutcome;
  sessionFamilyId?: string | null;
}

export interface AuthEventRow {
  id: string;
  userId: string | null;
  fullName: string | null;
  role: string | null;
  method: string;
  outcome: string;
  sessionFamilyId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface SessionRow {
  familyId: string;
  userId: string;
  fullName: string;
  role: string;
  phone: string;
  startedAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

const MAX_USER_AGENT = 300;

/**
 * سجل المصادقة: كل محاولة دخول تُقيَّد بنتيجتها، والجلسة النشطة تُشتق من
 * سلالة refresh غير المُبطَلة — فتُعرف الأجهزة المتصلة وتُقطع عند الحاجة.
 */
@Injectable()
export class AuthEventsService {
  private readonly logger = new Logger(AuthEventsService.name);

  constructor(@Inject(DB) private readonly db: DbClient) {}

  /**
   * التسجيل لا يُفشل عملية الدخول: فقدان سطر في السجل أهون من منع مستخدم
   * شرعي أو من إخفاء سبب الفشل الحقيقي خلف خطأ كتابة.
   */
  async record(args: RecordAuthEventArgs): Promise<void> {
    try {
      await this.db.insert(authEvents).values({
        userId: args.userId ?? null,
        method: args.method,
        outcome: args.outcome,
        sessionFamilyId: args.sessionFamilyId ?? null,
        ip: args.ip ?? null,
        userAgent: args.userAgent ? args.userAgent.slice(0, MAX_USER_AGENT) : null,
        requestId: args.requestId ?? null,
      });
    } catch (err) {
      this.logger.error({ err, outcome: args.outcome }, 'failed to record auth event');
    }
  }

  async listEvents(query: {
    userId?: string;
    outcome?: AuthEventOutcome;
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: AuthEventRow[]; total: number; limit: number; offset: number }> {
    const conditions: SQL[] = [];
    if (query.userId) conditions.push(eq(authEvents.userId, query.userId));
    if (query.outcome) conditions.push(eq(authEvents.outcome, query.outcome));
    if (query.from) conditions.push(gte(authEvents.createdAt, query.from));
    if (query.to) conditions.push(lte(authEvents.createdAt, query.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [count]] = await Promise.all([
      this.db
        .select({
          id: authEvents.id,
          userId: authEvents.userId,
          fullName: users.fullName,
          role: users.role,
          method: authEvents.method,
          outcome: authEvents.outcome,
          sessionFamilyId: authEvents.sessionFamilyId,
          ip: authEvents.ip,
          userAgent: authEvents.userAgent,
          createdAt: authEvents.createdAt,
        })
        .from(authEvents)
        .leftJoin(users, eq(users.id, authEvents.userId))
        .where(where)
        .orderBy(desc(authEvents.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(authEvents)
        .where(where),
    ]);
    return { items, total: count?.count ?? 0, limit: query.limit, offset: query.offset };
  }

  /**
   * الجلسات النشطة = سلالات refresh التي فيها رمز حيّ (غير مُبطَل ولم ينتهِ).
   * كل تدوير يضيف صفاً للسلالة نفسها، فأحدث صف يمثل آخر نشاط.
   */
  async listActiveSessions(query: { userId?: string; limit: number; offset: number }): Promise<{
    items: SessionRow[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const conditions: SQL[] = [
      isNull(refreshTokens.revokedAt),
      gte(refreshTokens.expiresAt, new Date()),
    ];
    if (query.userId) conditions.push(eq(refreshTokens.userId, query.userId));
    const where = and(...conditions);

    // السلالة تخص مستخدماً واحداً، فالتجميع عليهما معاً يغني عن أي تحويل
    const [rows, [count]] = await Promise.all([
      this.db
        .select({
          familyId: refreshTokens.familyId,
          userId: refreshTokens.userId,
          fullName: users.fullName,
          role: users.role,
          phone: users.phone,
          startedAt: sql<Date>`min(${refreshTokens.createdAt})`,
          lastSeenAt: sql<Date>`max(${refreshTokens.createdAt})`,
          expiresAt: sql<Date>`max(${refreshTokens.expiresAt})`,
        })
        .from(refreshTokens)
        .innerJoin(users, eq(users.id, refreshTokens.userId))
        .where(where)
        .groupBy(refreshTokens.familyId, refreshTokens.userId, users.fullName, users.role, users.phone)
        .orderBy(sql`max(${refreshTokens.createdAt}) desc`)
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ count: sql<number>`count(distinct ${refreshTokens.familyId})::int` })
        .from(refreshTokens)
        .where(where),
    ]);

    // الجهاز والعنوان من حدث الدخول الذي أنشأ السلالة — استعلام منفصل يتجنّب
    // تكرار الصفوف لو حملت السلالة أكثر من حدث
    const families = rows.map((r) => r.familyId);
    const devices = new Map<string, { ip: string | null; userAgent: string | null }>();
    if (families.length > 0) {
      const events = await this.db
        .select({
          familyId: authEvents.sessionFamilyId,
          ip: authEvents.ip,
          userAgent: authEvents.userAgent,
        })
        .from(authEvents)
        .where(inArray(authEvents.sessionFamilyId, families))
        .orderBy(authEvents.createdAt);
      for (const e of events) {
        if (e.familyId && !devices.has(e.familyId)) {
          devices.set(e.familyId, { ip: e.ip, userAgent: e.userAgent });
        }
      }
    }

    return {
      items: rows.map((r) => ({
        ...r,
        ip: devices.get(r.familyId)?.ip ?? null,
        userAgent: devices.get(r.familyId)?.userAgent ?? null,
      })),
      total: count?.count ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  /** ملخص سريع لشاشة الأمان: محاولات فاشلة وجلسات نشطة خلال نافذة */
  async summary(sinceHours = 24): Promise<{
    since: Date;
    successCount: number;
    failureCount: number;
    activeSessions: number;
    distinctIps: number;
  }> {
    const since = new Date(Date.now() - sinceHours * 3_600_000);
    const [[events], [sessions]] = await Promise.all([
      this.db
        .select({
          successCount: sql<number>`count(*) filter (where ${authEvents.outcome} = 'success')::int`,
          failureCount: sql<number>`count(*) filter (where ${authEvents.outcome} not in ('success','logout','enrollment_completed'))::int`,
          distinctIps: sql<number>`count(distinct ${authEvents.ip})::int`,
        })
        .from(authEvents)
        .where(gte(authEvents.createdAt, since)),
      this.db
        .select({ count: sql<number>`count(distinct ${refreshTokens.familyId})::int` })
        .from(refreshTokens)
        .where(and(isNull(refreshTokens.revokedAt), gte(refreshTokens.expiresAt, new Date()))),
    ]);
    return {
      since,
      successCount: events?.successCount ?? 0,
      failureCount: events?.failureCount ?? 0,
      activeSessions: sessions?.count ?? 0,
      distinctIps: events?.distinctIps ?? 0,
    };
  }

  /** صاحب الجلسة — للتدقيق قبل قطعها */
  async sessionOwner(familyId: string): Promise<{ userId: string; fullName: string } | null> {
    const [row] = await this.db
      .select({ userId: refreshTokens.userId, fullName: users.fullName })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(eq(refreshTokens.familyId, familyId))
      .limit(1);
    return row ?? null;
  }
}
