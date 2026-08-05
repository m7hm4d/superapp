import { BadRequestException, Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { Role, zUpdateCity, zUpdateFlag, zUuid } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { FlagsService } from '../flags/flags.service';
import { AdminService, type UpdateCityInput } from './admin.service';
import { AuditService, type RequestWithId } from './audit.service';

const zFlagKey = z.string().min(1).max(120);

type UpdateFlagBody = z.infer<typeof zUpdateFlag>;

@Roles(Role.ADMIN)
@Controller('admin')
export class AdminConfigController {
  constructor(
    private readonly flagsService: FlagsService,
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
  ) {}

  // ---------- الأعلام ----------

  @Get('flags')
  listFlags() {
    return this.flagsService.getAll();
  }

  @Patch('flags/:key')
  async updateFlag(
    @Param('key', new ZodValidationPipe(zFlagKey)) key: string,
    @Body(new ZodValidationPipe(zUpdateFlag)) body: UpdateFlagBody,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    if (body.enabled === undefined && body.value === undefined) {
      throw new BadRequestException({ code: 'EMPTY_UPDATE' });
    }
    const updated = await this.flagsService.update(key, body, user.id);
    await this.audit.log(user.id, 'update_flag', 'feature_flag', key, body, undefined, req.id);
    return updated;
  }

  // ---------- المدن ----------

  @Get('cities')
  listCities() {
    return this.adminService.listCities();
  }

  @Patch('cities/:id')
  async updateCity(
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zUpdateCity)) body: UpdateCityInput,
    @CurrentUser() user: RequestUser,
    @Req() req: RequestWithId,
  ) {
    const updated = await this.adminService.updateCity(id, body);
    await this.audit.log(user.id, 'update_city', 'city', id, body, undefined, req.id);
    return updated;
  }
}
