import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  ProductView,
  Role,
  zCreateProduct,
  zSetOpen,
  zUpdateProduct,
  zUpdateVendorProfile,
  zUuid,
} from '@superapp/shared';
import { CurrentUser, RequestUser, Roles, SkipApproval } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CreateProductDto, ProductsService, UpdateProductDto } from './products.service';
import {
  SetOpenDto,
  UpdateVendorProfileDto,
  VendorProfileView,
  VendorsService,
} from './vendors.service';

/** إدارة البائع الذاتية — دور VENDOR فقط */
@Roles(Role.VENDOR)
@Controller('vendor')
export class VendorSelfController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly products: ProductsService,
  ) {}

  @SkipApproval()
  @Get('profile')
  getProfile(@CurrentUser() user: RequestUser): Promise<VendorProfileView> {
    return this.vendors.getOwnProfile(user.id);
  }

  @SkipApproval()
  @Patch('profile')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zUpdateVendorProfile)) body: UpdateVendorProfileDto,
  ): Promise<VendorProfileView> {
    return this.vendors.updateOwnProfile(user.id, body);
  }

  @Patch('profile/open')
  setOpen(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zSetOpen)) body: SetOpenDto,
  ): Promise<{ id: string; isOpen: boolean }> {
    return this.vendors.setOpen(user.id, body);
  }

  @Get('products')
  listProducts(@CurrentUser() user: RequestUser): Promise<ProductView[]> {
    return this.products.listOwn(user.id);
  }

  @Post('products')
  createProduct(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zCreateProduct)) body: CreateProductDto,
  ): Promise<ProductView> {
    return this.products.create(user.id, body);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
    @Body(new ZodValidationPipe(zUpdateProduct)) body: UpdateProductDto,
  ): Promise<ProductView> {
    return this.products.update(user.id, id, body);
  }

  @Delete('products/:id')
  deleteProduct(
    @CurrentUser() user: RequestUser,
    @Param('id', new ZodValidationPipe(zUuid)) id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    return this.products.softDelete(user.id, id);
  }
}
