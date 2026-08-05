import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role, zUuid } from '@superapp/shared';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SettlementsService } from '../ledger/settlements.service';
import { AuditService, type RequestWithId } from './audit.service';
import {
  OpsService,
  zAdminFinanceQuery,
  zAdminLedgerQuery,
  zAdminSettlementsQuery,
  zResolveSettlement,
  zReverseEntry,
  type AdminFinanceQuery,
  type AdminLedgerQuery,
  type AdminSettlementsQuery,
  type ResolveSettlementInput,
  type ReverseEntryInput,
} from './ops.service';

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly ops: OpsService,
    private readonly settlementsService: SettlementsService,
    private readonly audit: AuditService,
  ) {}

  @Get('finance/summary')
  summary(@Query(new ZodValidationPipe(zAdminFinanceQuery)) query: AdminFinanceQuery) {
    return this.ops.financeSummary(query);
  }

  @Get('ledger')
  ledger(@Query(new ZodValidationPipe(zAdminLedgerQuery)) query: AdminLedgerQuery) {
    return this.ops.listLedger(query);
  }

  @Post('ledger/:entryId/reverse')
  async reverse(
    @Param('entryId', new ZodValidationPipe(zUuid)) entryId: string,
    @Body(new ZodValidationPipe(zReverseEntry)) body: ReverseEntryInput,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const reversal = await this.ops.reverseLedgerEntry(entryId, user.id, body.reason);
    await this.audit.log(
      user.id,
      'reverse_ledger_entry',
      'ledger_entry',
      entryId,
      { reversalId: reversal.id, amountIqd: reversal.amountIqd },
      body.reason,
      req.id,
    );
    return reversal;
  }

  @Get('settlements')
  settlements(
    @Query(new ZodValidationPipe(zAdminSettlementsQuery)) query: AdminSettlementsQuery,
  ) {
    return this.ops.listSettlements(query);
  }

  /**
   * حسم اعتراض المخبز: DISPUTED → SETTLED مع كتابة قيود الدفتر ذرّياً.
   * الأداة الوحيدة لفك التسويات المعترَض عليها — وهي تحجب بدء تسوية جديدة
   * لنفس الثنائي حتى تُحسم (منع الخصم المزدوج).
   */
  @Post('settlements/:settlementId/resolve')
  async resolveSettlement(
    @Param('settlementId', new ZodValidationPipe(zUuid)) settlementId: string,
    @Body(new ZodValidationPipe(zResolveSettlement)) body: ResolveSettlementInput,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const settlement = await this.settlementsService.adminResolve(
      settlementId,
      user.id,
      body.reason,
    );
    await this.audit.log(
      user.id,
      'resolve_settlement',
      'settlement',
      settlementId,
      {
        amountIqd: settlement.amountIqd,
        vendorId: settlement.vendorId,
        driverId: settlement.driverId,
        orderIds: settlement.orderIds,
      },
      body.reason,
      req.id,
    );
    return settlement;
  }
}
