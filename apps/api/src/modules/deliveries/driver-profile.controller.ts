import { Body, Controller, Patch } from '@nestjs/common';
import { Role, zLocationPing, zSetAvailability } from '@superapp/shared';
import type { LatLng } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/decorators';
import type { RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DriversService } from './drivers.service';

type SetAvailabilityDto = z.infer<typeof zSetAvailability>;

/** توفر السائق ونبض الموقع (D-02) */
@Controller('driver')
@Roles(Role.DRIVER)
export class DriverProfileController {
  constructor(private readonly driversService: DriversService) {}

  @Patch('availability')
  setAvailability(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zSetAvailability)) body: SetAvailabilityDto,
  ): Promise<{ isAvailable: boolean }> {
    return this.driversService.setAvailability(user.id, body.isAvailable);
  }

  @Patch('location')
  pingLocation(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zLocationPing)) body: LatLng,
  ): Promise<{ ok: true }> {
    return this.driversService.pingLocation(user.id, body);
  }
}
