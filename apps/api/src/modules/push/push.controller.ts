import { Body, Controller, Delete, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SkipApproval, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PushService } from './push.service';

const zRegisterToken = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android']).optional(),
});
type RegisterTokenInput = z.infer<typeof zRegisterToken>;

@Controller('me/push-token')
export class PushController {
  constructor(private readonly push: PushService) {}

  @SkipApproval()
  @Post()
  register(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zRegisterToken)) body: RegisterTokenInput,
  ) {
    return this.push.registerToken(user.id, body.token, body.platform);
  }

  @SkipApproval()
  @Delete()
  remove(@Body(new ZodValidationPipe(zRegisterToken)) body: RegisterTokenInput) {
    return this.push.removeToken(body.token);
  }
}
