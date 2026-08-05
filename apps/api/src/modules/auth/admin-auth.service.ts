import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthTokens, AuthUser, Role, UserStatus } from '@superapp/shared';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { DB, DbClient } from '../../db/drizzle.module';
import { adminCredentials, users } from '../../db/schema';
import { TokenService } from './token.service';

/** دخول الإدارة مستقل عن تدفق الهاتف: بريد + كلمة مرور قوية + TOTP (الملف §3) */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tokens: TokenService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    totp?: string;
  }): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const [row] = await this.db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.email, input.email.toLowerCase().trim()))
      .limit(1);

    if (!row || row.user.role !== Role.ADMIN) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    if (row.user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException({ code: 'BLOCKED' });
    }
    const ok = await argon2.verify(row.user.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    if (row.cred.totpEnabled) {
      if (!input.totp) {
        throw new UnauthorizedException({ code: 'TOTP_REQUIRED' });
      }
      if (!row.cred.totpSecret || !authenticator.verify({ token: input.totp, secret: row.cred.totpSecret })) {
        throw new UnauthorizedException({ code: 'TOTP_INVALID' });
      }
    }

    const tokens = await this.tokens.issuePair(row.user);
    return {
      user: {
        id: row.user.id,
        phone: row.user.phone,
        fullName: row.user.fullName,
        role: row.user.role as Role,
      },
      tokens,
    };
  }

  /** توليد سر TOTP جديد (غير مفعّل حتى التأكيد) */
  async setupTotp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const [cred] = await this.db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!cred) throw new ForbiddenException({ code: 'NO_ADMIN_CREDENTIALS' });

    const secret = authenticator.generateSecret();
    await this.db
      .update(adminCredentials)
      .set({ totpSecret: secret, totpEnabled: false })
      .where(eq(adminCredentials.userId, userId));
    return {
      secret,
      otpauthUrl: authenticator.keyuri(cred.email, 'SuperApp Admin', secret),
    };
  }

  /** تفعيل TOTP بعد التحقق من أول رمز */
  async enableTotp(userId: string, token: string): Promise<{ enabled: true }> {
    const [cred] = await this.db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!cred?.totpSecret) throw new ForbiddenException({ code: 'TOTP_NOT_SETUP' });
    if (!authenticator.verify({ token, secret: cred.totpSecret })) {
      throw new UnauthorizedException({ code: 'TOTP_INVALID' });
    }
    await this.db
      .update(adminCredentials)
      .set({ totpEnabled: true })
      .where(eq(adminCredentials.userId, userId));
    return { enabled: true };
  }
}
