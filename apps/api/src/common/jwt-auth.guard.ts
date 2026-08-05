import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_TOTP_ENROLLMENT_KEY, IS_PUBLIC_KEY } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  phone: string;
  /** يوجد فقط في التوكنات المحدودة (تسجيل TOTP) — غيابه يعني جلسة كاملة */
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

    // التوكن المحدود (تسجيل TOTP) لا يفتح إلا المسارات التي تعلن قبوله صراحةً
    if (payload.scope) {
      const allowsEnrollment = this.reflector.getAllAndOverride<boolean>(
        ALLOW_TOTP_ENROLLMENT_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowsEnrollment) {
        throw new UnauthorizedException({ code: 'TOTP_ENROLLMENT_REQUIRED' });
      }
    }

    req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    return true;
  }
}
