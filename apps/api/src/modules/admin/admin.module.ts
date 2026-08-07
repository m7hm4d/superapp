import { Module } from '@nestjs/common';
import { ExceptionQueriesModule } from '../deliveries/exception-queries.module';
import { AuthModule } from '../auth/auth.module';
import { FlagsModule } from '../flags/flags.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminApprovalsController } from './admin-approvals.controller';
import { AdminBatchesController } from './admin-batches.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminExceptionsController } from './admin-exceptions.controller';
import { AdminFinanceController } from './admin-finance.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminSecurityController } from './admin-security.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { OpsService } from './ops.service';

@Module({
  imports: [ExceptionQueriesModule, OrdersModule, FlagsModule, LedgerModule, AuthModule],
  controllers: [
    AdminApprovalsController,
    AdminOrdersController,
    AdminBatchesController,
    AdminExceptionsController,
    AdminFinanceController,
    AdminUsersController,
    AdminConfigController,
    AdminSecurityController,
  ],
  providers: [AdminService, AuditService, OpsService],
  exports: [AuditService],
})
export class AdminModule {}
