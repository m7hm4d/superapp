import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApprovalStatus,
  AuthTokens,
  AuthUser,
  LoginInput,
  RegisterInput,
  Role,
  UserStatus,
} from '@superapp/shared';
import { argon2id, hash, verify } from 'argon2';
import { asc, eq } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { cities, driverProfiles, users, vendorProfiles } from '../../db/schema';
import { AuthEventsService, type AuthContext } from './auth-events.service';
import { TokenService } from './token.service';

type UserRow = typeof users.$inferSelect;

/** معايير OWASP لـ argon2id */
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tokens: TokenService,
    private readonly events: AuthEventsService,
  ) {}

  async register(input: RegisterInput): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, input.phone))
      .limit(1);
    if (existing) {
      throw new ConflictException({ code: 'PHONE_EXISTS', message: 'رقم الهاتف مسجل مسبقاً' });
    }

    // البائع/السائق يُربطان بالمدينة الوحيدة المهيّأة (أول مدينة فعّالة)
    let cityId: string | null = null;
    if (input.role === Role.VENDOR || input.role === Role.DRIVER) {
      const [city] = await this.db
        .select({ id: cities.id })
        .from(cities)
        .where(eq(cities.isActive, true))
        .orderBy(asc(cities.createdAt))
        .limit(1);
      if (!city) {
        throw new InternalServerErrorException({
          code: 'NO_ACTIVE_CITY',
          message: 'لا توجد مدينة فعّالة مهيّأة',
        });
      }
      cityId = city.id;
    }

    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    let user: UserRow;
    let approvalStatus: string | undefined;
    try {
      const result = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            phone: input.phone,
            passwordHash,
            fullName: input.fullName,
            role: input.role,
          })
          .returning();

        let profileStatus: string | undefined;
        if (input.role === Role.VENDOR) {
          await tx.insert(vendorProfiles).values({
            userId: created.id,
            cityId: cityId as string,
            storeNameAr: input.storeNameAr,
            category: input.category,
            location: input.location,
            addressText: input.addressText,
            approvalStatus: ApprovalStatus.PENDING,
          });
          profileStatus = ApprovalStatus.PENDING;
        } else if (input.role === Role.DRIVER) {
          await tx.insert(driverProfiles).values({
            userId: created.id,
            cityId: cityId as string,
            vehicleType: input.vehicleType,
            approvalStatus: ApprovalStatus.PENDING,
          });
          profileStatus = ApprovalStatus.PENDING;
        }
        return { created, profileStatus };
      });
      user = result.created;
      approvalStatus = result.profileStatus;
    } catch (e) {
      // سباق على unique(phone) — نفس رد التحقق المسبق
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException({ code: 'PHONE_EXISTS', message: 'رقم الهاتف مسجل مسبقاً' });
      }
      throw e;
    }

    // البائع/السائق pending يحصلان على tokens — ApprovedGuard يحجب مسارات العمل
    const tokens = await this.tokens.issuePair(user);
    return { user: this.toAuthUser(user, approvalStatus), tokens };
  }

  async login(
    input: LoginInput,
    ctx: AuthContext = {},
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const event = { ...ctx, method: 'phone_password' as const };
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, input.phone))
      .limit(1);
    if (!user) {
      // لا نخزّن الرقم المُدخَل: قد يكون خطأ كتابة، ويكفي أثر المحاولة وعنوانها
      await this.events.record({ ...event, outcome: 'unknown_identifier' });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'رقم الهاتف أو كلمة المرور غير صحيحة',
      });
    }

    const valid = await verify(user.passwordHash, input.password);
    if (!valid) {
      await this.events.record({ ...event, userId: user.id, outcome: 'invalid_credentials' });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'رقم الهاتف أو كلمة المرور غير صحيحة',
      });
    }

    // حسابات الإدارة لا تدخل من مسار الهاتف إطلاقاً — دخولها حصراً عبر
    // /auth/admin/login (بريد + كلمة مرور + TOTP). الرد مطابق لخطأ الاعتماديات
    // كي لا يكشف أن الرقم يعود لحساب إداري.
    if (user.role === Role.ADMIN) {
      await this.events.record({ ...event, userId: user.id, outcome: 'admin_login_denied' });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'رقم الهاتف أو كلمة المرور غير صحيحة',
      });
    }

    if (user.status === UserStatus.BLOCKED) {
      await this.events.record({ ...event, userId: user.id, outcome: 'blocked' });
      throw new ForbiddenException({ code: 'BLOCKED', message: 'الحساب محظور' });
    }

    const approvalStatus = await this.approvalStatusFor(user.id, user.role);
    const tokens = await this.tokens.issuePairWithFamily(user);
    await this.events.record({
      ...event,
      userId: user.id,
      outcome: 'success',
      sessionFamilyId: tokens.familyId,
    });
    return { user: this.toAuthUser(user, approvalStatus), tokens };
  }

  async me(userId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        phone: users.phone,
        fullName: users.fullName,
        role: users.role,
        status: users.status,
        locale: users.locale,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND' });
    }

    if (user.role === Role.VENDOR) {
      const [profile] = await this.db
        .select()
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, userId))
        .limit(1);
      return { user, profile: profile ?? null };
    }
    if (user.role === Role.DRIVER) {
      const [profile] = await this.db
        .select()
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, userId))
        .limit(1);
      return { user, profile: profile ?? null };
    }
    return { user, profile: null };
  }

  private async approvalStatusFor(userId: string, role: Role): Promise<string | undefined> {
    if (role === Role.VENDOR) {
      const [p] = await this.db
        .select({ approvalStatus: vendorProfiles.approvalStatus })
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, userId))
        .limit(1);
      return p?.approvalStatus;
    }
    if (role === Role.DRIVER) {
      const [p] = await this.db
        .select({ approvalStatus: driverProfiles.approvalStatus })
        .from(driverProfiles)
        .where(eq(driverProfiles.userId, userId))
        .limit(1);
      return p?.approvalStatus;
    }
    return undefined;
  }

  private toAuthUser(user: UserRow, approvalStatus?: string): AuthUser {
    return {
      id: user.id,
      phone: user.phone,
      fullName: user.fullName,
      role: user.role,
      ...(approvalStatus ? { approvalStatus } : {}),
    };
  }
}
