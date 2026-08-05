import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Role, SocketRooms } from '@superapp/shared';
import { eq } from 'drizzle-orm';
import { Server, Socket } from 'socket.io';
import { DB, DbClient } from '../db/drizzle.module';
import { driverProfiles, vendorProfiles } from '../db/schema';

interface SocketAuthData {
  userId: string;
  role: Role;
  cityId?: string;
  vendorProfileId?: string;
}

/**
 * توثيق JWT في handshake ثم انضمام للغرف حسب الدور (الملف §10).
 * الـ socket إشعار فقط — الحقيقة عبر REST؛ عند reconnect تعيد التطبيقات الجلب.
 */
@WebSocketGateway({ namespace: '/rt', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: DbClient,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token: string | undefined =
        client.handshake.auth?.token ?? (client.handshake.headers['authorization'] as string)?.slice(7);
      if (!token) throw new Error('no token');
      const payload = await this.jwt.verifyAsync<{ sub: string; role: Role }>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });

      const data: SocketAuthData = { userId: payload.sub, role: payload.role };
      client.data = data;

      await client.join(SocketRooms.user(payload.sub));

      if (payload.role === Role.VENDOR) {
        const [vp] = await this.db
          .select({ id: vendorProfiles.id })
          .from(vendorProfiles)
          .where(eq(vendorProfiles.userId, payload.sub))
          .limit(1);
        if (vp) {
          data.vendorProfileId = vp.id;
          await client.join(SocketRooms.vendor(vp.id));
        }
      } else if (payload.role === Role.DRIVER) {
        const [dp] = await this.db
          .select({ cityId: driverProfiles.cityId, isAvailable: driverProfiles.isAvailable })
          .from(driverProfiles)
          .where(eq(driverProfiles.userId, payload.sub))
          .limit(1);
        if (dp) {
          data.cityId = dp.cityId;
          // ينضم لغرفة المدينة دائماً؛ التطبيق يتجاهل العروض عندما يكون غير متصل للعمل
          await client.join(SocketRooms.drivers(dp.cityId));
        }
      } else if (payload.role === Role.ADMIN) {
        await client.join(SocketRooms.admin);
      }
    } catch {
      this.logger.warn(`socket auth failed: ${client.id}`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // لا حالة على القطع — الغرف تُنظف تلقائياً
  }
}
