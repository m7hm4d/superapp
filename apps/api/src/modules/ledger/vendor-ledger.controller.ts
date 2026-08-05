import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role, zConfirmSettlement, zDisputeSettlement } from '@superapp/shared';
import type { SettlementView } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SettlementsService } from './settlements.service';
import type { VendorLedgerView } from './settlements.service';

/** نطاق الدفتر اليومي؛ الافتراضي آخر 30 يوماً */
const zVendorLedgerQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

type VendorLedgerQuery = z.infer<typeof zVendorLedgerQuery>;
type ConfirmSettlementDto = z.infer<typeof zConfirmSettlement>;
type DisputeSettlementDto = z.infer<typeof zDisputeSettlement>;

@Controller('vendor')
@Roles(Role.VENDOR)
export class VendorLedgerController {
  constructor(private readonly settlementsService: SettlementsService) {}

  /** شاشة دفتر المخبز: صفوف يومية + مستحقات لدى السائقين + التسويات */
  @Get('ledger')
  ledger(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(zVendorLedgerQuery)) query: VendorLedgerQuery,
  ): Promise<VendorLedgerView> {
    return this.settlementsService.vendorOverview(user.id, query);
  }

  /** المخبز يؤكد استلام النقد بإدخال PIN التسوية الظاهر عند السائق */
  @Post('settlements/:id/confirm')
  confirm(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zConfirmSettlement)) body: ConfirmSettlementDto,
  ): Promise<SettlementView> {
    return this.settlementsService.confirm(user.id, id, body.pin);
  }

  @Post('settlements/:id/dispute')
  dispute(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(zDisputeSettlement)) body: DisputeSettlementDto,
  ): Promise<SettlementView> {
    return this.settlementsService.dispute(user.id, id, body.reason);
  }
}
