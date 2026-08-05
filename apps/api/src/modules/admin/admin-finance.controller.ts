import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role, zUuid } from '@superapp/shared';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AuditService, type RequestWithId } from './audit.service';
import {
  OpsService,
  zAdminFinanceQuery,
  zAdminLedgerQuery,
  zAdminSettlementsQuery,
  zReverseEntry,
  type AdminFinanceQuery,
  type AdminLedgerQuery,
  type AdminSettlementsQuery,
  type ReverseEntryInput,
} from './ops.service';

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly ops: OpsService,
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
}
