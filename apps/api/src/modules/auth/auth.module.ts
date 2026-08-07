import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { AuthEventsService } from './auth-events.service';
import { UserDirectoryService } from './user-directory.service';
import { AuthService } from './auth.service';
import { PasskeyService } from './passkey.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController, AdminAuthController],
  providers: [UserDirectoryService, AuthService, TokenService, AdminAuthService, AuthEventsService, PasskeyService],
  // وحدة الإدارة تعرض سجل الدخول والجلسات وتقطعها
  exports: [UserDirectoryService, TokenService, AuthEventsService, PasskeyService],
})
export class AuthModule {}
