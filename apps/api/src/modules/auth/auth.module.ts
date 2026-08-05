import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService, TokenService, AdminAuthService],
  exports: [TokenService],
})
export class AuthModule {}
