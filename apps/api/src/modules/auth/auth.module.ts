import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { AuthEventsService } from './auth-events.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, TokenService, AdminAuthService, AuthEventsService],
  // وحدة الإدارة تعرض سجل الدخول والجلسات وتقطعها
  exports: [TokenService, AuthEventsService],
})
export class AuthModule {}
