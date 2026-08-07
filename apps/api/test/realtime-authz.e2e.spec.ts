import { INestApplication } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ApprovalStatus, Role, SocketRooms, UserStatus } from '@superapp/shared';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { DB, DbClient } from '../src/db/drizzle.module';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { driverProfiles, users, vendorProfiles } from '../src/db/schema';

/**
 * انحدار: المصافحة كانت فحص توقيع لا أكثر.
 *
 * `ApprovedGuard` يحرس REST ولا يمرّ به الـsocket، فبائع موقوف أو سائق
 * مرفوض ينضم إلى غرف العمل ويستقبل مواقع المخابز والأجور وأحداث الطلبات
 * والتسويات. ومستخدم محظور يبقى متصلاً، واتصال أُنشئ قبل إبطال جلسته يبقى
 * قائماً إلى أن ينقطع من تلقاء نفسه — إبطال رمز التحديث كان يقطع REST
 * ولا يمسّ الـsocket.
 */
describe('realtime handshake authorization', () => {
  let app: INestApplication;
  let db: DbClient;
  let jwt: JwtService;
  let gateway: RealtimeGateway;
  let url: string;
  const open: Socket[] = [];

  const accessTokenFor = (userId: string, role: Role, familyId = randomUUID(), ttl = '15m') =>
    jwt.signAsync(
      { sub: userId, role, phone: '+9647700000000', fid: familyId },
      {
        secret: process.env.JWT_ACCESS_SECRET!,
        expiresIn: ttl as JwtSignOptions['expiresIn'],
      },
    );

  /**
   * يفتح اتصالاً ويعيد الـsocket متصلاً أو null إن رُفض.
   *
   * الانتظار بعد `connect` مقصود: العميل يرى الاتصال قائماً بينما
   * `handleConnection` ما زالت تستعلم عن حالة المستخدم وموافقته — فالرفض
   * يصل بعد لحظة، وفحصُه قبلها يقرأ حالة لم تكتمل.
   */
  const connect = async (token: string): Promise<Socket | null> => {
    const socket = io(`${url}/rt`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
    });
    open.push(socket);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      const settle = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.on('connect', settle);
      socket.on('connect_error', settle);
    });
    await new Promise((r) => setTimeout(r, 300));
    return socket.connected ? socket : null;
  };

  /**
   * ‏@WebSocketServer() مع namespace يحقن الـNamespace لا الخادم الجذر —
   * النوع المعلن `Server` لكن القيمة وقت التشغيل `Namespace`، و`sockets`
   * فيها خريطة لا مساحة أسماء.
   */
  const rooms = (socket: Socket): Set<string> => {
    const namespace = gateway.server as unknown as {
      sockets: Map<string, { rooms: Set<string> }>;
    };
    const s = namespace.sockets.get(socket.id!);
    return s ? new Set(s.rooms) : new Set();
  };

  /** ينتظر انقطاع اتصال قائم — القطع من الخادم غير فوري */
  const waitForDisconnect = (socket: Socket, ms = 5000) =>
    new Promise<boolean>((resolve) => {
      if (socket.disconnected) return resolve(true);
      const timer = setTimeout(() => resolve(false), ms);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

  const makeUser = async (role: Role, status: UserStatus = UserStatus.ACTIVE) => {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      phone: `+96477${Math.floor(Math.random() * 100_000_000)}`,
      fullName: 'اختبار',
      role,
      status,
      passwordHash: 'x',
    });
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    db = app.get(DB);
    jwt = app.get(JwtService);
    gateway = app.get(RealtimeGateway);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    for (const s of open) s.disconnect();
    await app?.close();
  });

  it('يرفض المستخدم المحظور في المصافحة', async () => {
    const userId = await makeUser(Role.CUSTOMER, UserStatus.BLOCKED);
    expect(await connect(await accessTokenFor(userId, Role.CUSTOMER))).toBeNull();
  });

  it('يقبل المستخدم الفعّال ويضمّه لغرفته الشخصية', async () => {
    const userId = await makeUser(Role.CUSTOMER);
    const socket = await connect(await accessTokenFor(userId, Role.CUSTOMER));
    expect(socket).not.toBeNull();
    expect(rooms(socket!)).toContain(SocketRooms.user(userId));
  });

  it('سائق قيد المراجعة لا ينضم لغرفة المدينة', async () => {
    const userId = await makeUser(Role.DRIVER);
    const cityId = (await db.query.cities.findFirst())!.id;
    await db.insert(driverProfiles).values({
      userId,
      cityId,
      vehicleType: 'motorcycle',
      approvalStatus: ApprovalStatus.PENDING,
      isAvailable: true,
    });

    const socket = await connect(await accessTokenFor(userId, Role.DRIVER));
    expect(socket).not.toBeNull();
    expect(rooms(socket!)).not.toContain(SocketRooms.drivers(cityId));
  });

  it('سائق موافَق عليه لكنه غير متصل للعمل لا ينضم لغرفة العروض', async () => {
    const userId = await makeUser(Role.DRIVER);
    const cityId = (await db.query.cities.findFirst())!.id;
    await db.insert(driverProfiles).values({
      userId,
      cityId,
      vehicleType: 'motorcycle',
      approvalStatus: ApprovalStatus.APPROVED,
      isAvailable: false,
    });

    const socket = await connect(await accessTokenFor(userId, Role.DRIVER));
    expect(rooms(socket!)).not.toContain(SocketRooms.drivers(cityId));
  });

  it('سائق موافَق عليه ومتصل للعمل ينضم', async () => {
    const userId = await makeUser(Role.DRIVER);
    const cityId = (await db.query.cities.findFirst())!.id;
    await db.insert(driverProfiles).values({
      userId,
      cityId,
      vehicleType: 'motorcycle',
      approvalStatus: ApprovalStatus.APPROVED,
      isAvailable: true,
    });

    const socket = await connect(await accessTokenFor(userId, Role.DRIVER));
    expect(rooms(socket!)).toContain(SocketRooms.drivers(cityId));
  });

  it('بائع موقوف لا ينضم لغرفة متجره', async () => {
    const userId = await makeUser(Role.VENDOR);
    const cityId = (await db.query.cities.findFirst())!.id;
    const [vp] = await db
      .insert(vendorProfiles)
      .values({
        userId,
        cityId,
        storeNameAr: 'مخبز',
        category: 'bakery',
        addressText: 'شارع',
        location: { lat: 33.3, lng: 44.4 },
        approvalStatus: ApprovalStatus.SUSPENDED,
      })
      .returning({ id: vendorProfiles.id });

    const socket = await connect(await accessTokenFor(userId, Role.VENDOR));
    expect(rooms(socket!)).not.toContain(SocketRooms.vendor(vp.id));
  });

  it('إبطال الجلسة يقطع الاتصال القائم', async () => {
    const userId = await makeUser(Role.CUSTOMER);
    const familyId = randomUUID();
    const socket = await connect(await accessTokenFor(userId, Role.CUSTOMER, familyId));
    expect(socket).not.toBeNull();

    gateway.disconnectFamily(userId, familyId, 'test');
    expect(await waitForDisconnect(socket!)).toBe(true);
  });

  it('حظر المستخدم يقطع اتصاله القائم', async () => {
    const userId = await makeUser(Role.CUSTOMER);
    const socket = await connect(await accessTokenFor(userId, Role.CUSTOMER));
    expect(socket).not.toBeNull();

    await db.update(users).set({ status: UserStatus.BLOCKED }).where(eq(users.id, userId));
    gateway.disconnectUser(userId, 'test');
    expect(await waitForDisconnect(socket!)).toBe(true);
  });

  /**
   * الاتصال كان يعيش أطول من التوكن الذي أذن به: خمس عشرة دقيقة صلاحية
   * مقابل اتصال قد يدوم أياماً.
   */
  it('لا يبقى الاتصال بعد انتهاء توكن الوصول', async () => {
    const userId = await makeUser(Role.CUSTOMER);
    // توكن ينتهي بعد ثانيتين — الكنس الدوري يلتقطه
    const socket = await connect(await accessTokenFor(userId, Role.CUSTOMER, randomUUID(), '2s'));
    expect(socket).not.toBeNull();

    await new Promise((r) => setTimeout(r, 2100));
    // استدعاء مباشر بدل انتظار الدورة الكاملة (ثلاثون ثانية)
    (gateway as unknown as { dropExpired(): void }).dropExpired();
    expect(await waitForDisconnect(socket!)).toBe(true);
  }, 20_000);

  it('التوكن المحدود النطاق ليس جلسة', async () => {
    const userId = await makeUser(Role.ADMIN);
    const scoped = await jwt.signAsync(
      { sub: userId, role: Role.ADMIN, scope: 'admin_step_up' },
      { secret: process.env.JWT_ACCESS_SECRET!, expiresIn: '5m' },
    );
    expect(await connect(scoped)).toBeNull();
  });
});
