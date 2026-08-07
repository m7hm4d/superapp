import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOWED_SCOPES_KEY, IS_PUBLIC_KEY } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  phone: string;
  /** يوجد فقط في التوكنات المحدودة — غيابه يعني جلسة كاملة */
  scope?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ code: 'NO_TOKEN' });

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN' });
    }

    // التوكن المحدود لا يفتح إلا المسارات التي تعلن قبول **نطاقه بالاسم**.
    // المقارنة بالقيمة لا بالوجود: توكن الخطوة الثانية وتوكن التسجيل كلاهما
    // يحمل `scope`، ولكلٍّ منهما مسارات مختلفة تماماً.
    if (payload.scope) {
      const allowed = this.reflector.getAllAndOverride<string[] | undefined>(ALLOWED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed?.includes(payload.scope)) {
        throw new UnauthorizedException({ code: 'TOKEN_SCOPE_FORBIDDEN' });
      }
    }

    req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    return true;
  }
}
