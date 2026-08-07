import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderDirectoryModule } from '../orders/order-directory.module';
import { VendorsModule } from '../vendors/vendors.module';
import { ExceptionQueriesService } from './exception-queries.service';

/**
 * وحدة خفيفة: لا تستورد إلا المنافذ التي تُثري بها. لو وُضعت الخدمة في
 * `DeliveriesModule` لجرّت معها `LedgerModule` إلى كل من يطلبها.
 */
@Module({
  imports: [OrderDirectoryModule, VendorsModule, AuthModule],
  providers: [ExceptionQueriesService],
  exports: [ExceptionQueriesService],
})
export class ExceptionQueriesModule {}
