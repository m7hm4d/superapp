import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ApprovalStatus, Role, SocketRooms, UserStatus } from '@superapp/shared';
import { eq, inArray } from 'drizzle-orm';
import { Server, Socket } from 'socket.io';
import { DEFAULT_CORS_ORIGINS } from '../config/env.schema';
import { DB, DbClient } from '../db/drizzle.module';
import { driverProfiles, users, vendorProfiles } from '../db/schema';

interface SocketAuthData {
  userId: string;
  role: Role;
  /** عائلة الجلسة — يسمح بإسقاط جلسة بعينها دون بقية أجهزة المستخدم */
  familyId?: string;
  /** انتهاء توكن الوصول بالمللي ثانية — يُفحص دورياً */
  expiresAtMs: number;
  cityId?: string;
  vendorProfileId?: string;
}

/** كل كم يُكنس الاتصال المنتهي توكنه */
const EXPIRY_SWEEP_MS = 30_000;

/**
 * توثيق JWT في handshake ثم انضمام للغرف حسب الدور (الملف §10).
 * الـ socket إشعار فقط — الحقيقة عبر REST؛ عند reconnect تعيد التطبيقات الجلب.
 *
 * المصافحة **ليست** فحص توقيع فحسب. كانت كذلك، فترتّب عليها:
 *
 * - بائع أو سائق موقوف أو مرفوض يستقبل أحداث الطلبات والتسويات، لأن
 *   `ApprovedGuard` يحرس REST ولا يمرّ به الـsocket.
 * - مستخدم محظور يبقى متصلاً ما دام توكنه لم ينتهِ.
 * - اتصال أدمن أُنشئ قبل إبطال جلسته يبقى في غرفة الإدارة إلى أجل غير
 *   مسمّى — إبطال الجلسة كان يقطع REST ولا يمسّ الـsocket.
 * - عمر الاتصال يتجاوز عمر توكن الوصول، فلا يُعاد التحقق بعد المصافحة.
 *
 * فصار هنا: فحص حالة المستخدم وموافقته من القاعدة عند المصافحة، وفهرسة
 * الاتصالات كي تُقطع عند الخروج أو الإبطال أو الحظر أو تغيّر الموافقة،
 * وكنس دوري لما انتهى توكنه.
 */
@WebSocketGateway({
  namespace: '/rt',
  cors: {
    // كان `origin: true` أي أي أصل. المصدر نفسه الذي يحرس REST.
    // من البيئة مباشرة لا عبر ConfigService: المزخرِف يُقيَّم وقت تعريف
    // الصنف، أي قبل أن يوجد الحاقن.
    origin: (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  /** فهرس بالمستخدم: القطع عند الحظر أو الإبطال يحتاج الوصول للاتصالات القائمة */
  private readonly byUser = new Map<string, Set<Socket>>();

  private readonly sweep: ReturnType<typeof setInterval>;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: DbClient,
  ) {
    // توكن الوصول يعيش خمس عشرة دقيقة، والاتصال قد يعيش أياماً. بلا هذا
    // الكنس يبقى الوصول قائماً بعد انتهاء ما أذن به — والعميل يعيد الاتصال
    // بتوكن حيّ تلقائياً (‏getToken يُقيَّم عند كل محاولة).
    this.sweep = setInterval(() => this.dropExpired(), EXPIRY_SWEEP_MS);
    this.sweep.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.sweep);
  }

  async handleConnection(client: Socket) {
    try {
      const token: string | undefined =
        client.handshake.auth?.token ?? (client.handshake.headers['authorization'] as string)?.slice(7);
      if (!token) throw new Error('no token');
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        role: Role;
        scope?: string;
        fid?: string;
        exp?: number;
      }>(token, { secret: this.config.getOrThrow('JWT_ACCESS_SECRET') });

      // التوكنات المحدودة (تسجيل، أو خطوة ثانية بكلمة المرور وحدها) ليست
      // جلسات. بلا هذا الفحص ينضم من يعرف كلمة المرور فقط إلى غرفة الأدمن
      // ويستقبل أحداث الطلبات والتسويات قبل أن يجتاز عاملاً ثانياً.
      if (payload.scope) throw new Error('scoped token is not a session');

      // حالة الحساب من القاعدة لا من التوكن: الحظر يقع بعد الإصدار، والتوكن
      // لا يعرف عنه شيئاً حتى ينتهي.
      const [user] = await this.db
        .select({ status: users.status, role: users.role })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);
      if (!user || user.status !== UserStatus.ACTIVE) throw new Error('user not active');

      // الدور يُقارَن لا يُؤخذ.
      //
      // أخذُه من القاعدة كان يعني أن رمزاً صدر لزبون يدخل غرفة الإدارة بمجرد
      // ترقية صفّه — بلا مصادقة إدارة ولا عامل ثانٍ. تغيّر الدور يُنهي الجلسة
      // ولا يُطبَّق على اتصال برمز قديم.
      if (user.role !== payload.role) throw new Error('role changed');
      const role = user.role;

      const data: SocketAuthData = {
        userId: payload.sub,
        role,
        familyId: payload.fid,
        expiresAtMs: (payload.exp ?? 0) * 1000,
      };
      client.data = data;
      this.index(client);

      // غرفة المستخدم الشخصية لا تشترط موافقة: إشعارات حسابه هو، ومنها
      // إخبارُه بأن طلب انضمامه قُبل أو رُفض.
      await client.join(SocketRooms.user(payload.sub));

      if (role === Role.VENDOR) {
        const [vp] = await this.db
          .select({ id: vendorProfiles.id, approvalStatus: vendorProfiles.approvalStatus })
          .from(vendorProfiles)
          .where(eq(vendorProfiles.userId, payload.sub))
          .limit(1);
        // غرفة المتجر مشروطة بالموافقة — نظير ApprovedGuard على REST
        if (vp && vp.approvalStatus === ApprovalStatus.APPROVED) {
          data.vendorProfileId = vp.id;
          await client.join(SocketRooms.vendor(vp.id));
        }
      } else if (role === Role.DRIVER) {
        const [dp] = await this.db
          .select({
            cityId: driverProfiles.cityId,
            isAvailable: driverProfiles.isAvailable,
            approvalStatus: driverProfiles.approvalStatus,
          })
          .from(driverProfiles)
          .where(eq(driverProfiles.userId, payload.sub))
          .limit(1);
        if (dp) {
          data.cityId = dp.cityId;
          // غرفة العروض تحمل مواقع المخابز والأجور وعدد الطلبات. كان
          // الانضمام دائماً والتصفية في التطبيق — أي أن سائقاً غير موافق
          // عليه أو غير متصل للعمل يستقبلها كلها ولا شيء يمنعه من قراءتها.
          if (dp.approvalStatus === ApprovalStatus.APPROVED && dp.isAvailable) {
            await client.join(SocketRooms.drivers(dp.cityId));
          }
        }
      } else if (role === Role.ADMIN) {
        await client.join(SocketRooms.admin);
      }
    } catch {
      this.logger.warn(`socket auth failed: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.unindex(client);
  }

  // ─────────────────────────── قطع الاتصالات القائمة ───────────────────────────

  /** يقطع كل اتصالات مستخدم — للحظر وتغيّر الموافقة وخفض الرتبة */
  disconnectUser(userId: string, reason: string): number {
    const sockets = this.byUser.get(userId);
    if (!sockets?.size) return 0;
    const count = sockets.size;
    for (const socket of [...sockets]) socket.disconnect(true);
    this.logger.log(`socket disconnect user=${userId} n=${count} reason=${reason}`);
    return count;
  }

  /**
   * يقطع اتصالات عائلة جلسة بعينها — للخروج وإبطال الجلسة من اللوحة.
   *
   * التوكنات المُصدَرة قبل إضافة `fid` لا تحمل عائلة؛ تُقطع مع أي إبطال
   * يخص صاحبها. القطع الزائد يكلّف إعادة اتصال، وتركُها يكلّف جلسة حيّة
   * بعد إبطالها.
   */
  disconnectFamily(userId: string, familyId: string, reason: string): number {
    const sockets = this.byUser.get(userId);
    if (!sockets?.size) return 0;
    let count = 0;
    for (const socket of [...sockets]) {
      const data = socket.data as SocketAuthData;
      if (data.familyId === undefined || data.familyId === familyId) {
        socket.disconnect(true);
        count += 1;
      }
    }
    if (count) this.logger.log(`socket disconnect family=${familyId} n=${count} reason=${reason}`);
    return count;
  }

  /**
   * يزامن غرفة العروض مع حالة الاتصال للعمل.
   *
   * بلا هذا يبقى الانضمام كما كان لحظة المصافحة: سائق يتوقف عن العمل يظل
   * يستقبل العروض حتى يقطع الاتصال، ومن يبدأ العمل لا يستقبل شيئاً حتى
   * يعيد الاتصال.
   */
  async syncDriverAvailability(userId: string, cityId: string, isAvailable: boolean): Promise<void> {
    const sockets = this.byUser.get(userId);
    if (!sockets?.size) return;
    const room = SocketRooms.drivers(cityId);
    for (const socket of sockets) {
      if (isAvailable) await socket.join(room);
      else await socket.leave(room);
    }
  }

  // ─────────────────────────────── داخلي ───────────────────────────────

  private index(client: Socket): void {
    const { userId } = client.data as SocketAuthData;
    const set = this.byUser.get(userId) ?? new Set<Socket>();
    set.add(client);
    this.byUser.set(userId, set);
  }

  private unindex(client: Socket): void {
    const data = client.data as SocketAuthData | undefined;
    if (!data?.userId) return;
    const set = this.byUser.get(data.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.byUser.delete(data.userId);
  }

  private dropExpired(): void {
    const now = Date.now();
    for (const sockets of this.byUser.values()) {
      for (const socket of [...sockets]) {
        const data = socket.data as SocketAuthData;
        if (data.expiresAtMs > 0 && data.expiresAtMs <= now) socket.disconnect(true);
      }
    }
    void this.dropStaleRoles();
  }

  /**
   * يُسقط اتصالاً تغيّر دور صاحبه أو حُظر بعد مصافحته.
   *
   * الإبطال في المسارات الأخرى يقع عند مرور طلب، واتصال صامت لا يمرّ به
   * شيء: من يفتح التطبيق ويتركه يبقى في غرفته بدوره القديم إلى أجل غير
   * مسمّى. الكنس يغلق هذه الفجوة خلال دورة واحدة.
   */
  private async dropStaleRoles(): Promise<void> {
    const ids = [...this.byUser.keys()];
    if (ids.length === 0) return;
    const rows = await this.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(inArray(users.id, ids));
    const live = new Map(rows.map((r) => [r.id, r]));

    for (const [userId, sockets] of this.byUser) {
      const row = live.get(userId);
      for (const socket of [...sockets]) {
        const data = socket.data as SocketAuthData;
        if (!row || row.status !== UserStatus.ACTIVE || row.role !== data.role) {
          this.logger.log(`socket dropped: user=${userId} reason=stale role/status`);
          socket.disconnect(true);
        }
      }
    }
  }
}
