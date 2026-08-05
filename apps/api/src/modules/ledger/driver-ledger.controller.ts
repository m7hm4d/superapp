import { Body, Controller, Get, Post } from '@nestjs/common';
import { Role, zInitiateSettlement } from '@superapp/shared';
import type { SettlementView } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SettlementsService } from './settlements.service';
import type { DriverLedgerView } from './settlements.service';

type InitiateSettlementDto = z.infer<typeof zInitiateSettlement>;

@Controller('driver')
@Roles(Role.DRIVER)
export class DriverLedgerController {
  constructor(private readonly settlementsService: SettlementsService) {}

  /** شاشة محفظة السائق: اليوم + النقد بيده + المستحق لكل مخبز + التسويات */
  @Get('ledger')
  ledger(@CurrentUser() user: RequestUser): Promise<DriverLedgerView> {
    return this.settlementsService.driverOverview(user.id);
  }

  /** بدء تسوية مع مخبز — الاستجابة تتضمن settlementPin ليعرضه السائق للمخبز */
  @Post('settlements')
  initiate(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zInitiateSettlement)) body: InitiateSettlementDto,
  ): Promise<SettlementView> {
    return this.settlementsService.initiate(user.id, body.vendorId);
  }
}
