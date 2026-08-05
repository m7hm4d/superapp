import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ProductView, zCreateProduct, zUpdateProduct } from '@superapp/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DB, DbClient } from '../../db/drizzle.module';
import { products } from '../../db/schema';
import { toProductView, VendorsService } from './vendors.service';

export type CreateProductDto = z.infer<typeof zCreateProduct>;
export type UpdateProductDto = z.infer<typeof zUpdateProduct>;

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly vendors: VendorsService,
  ) {}

  async listOwn(userId: string): Promise<ProductView[]> {
    const profile = await this.vendors.requireProfileByUser(userId);
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.vendorId, profile.id), eq(products.isDeleted, false)))
      .orderBy(asc(products.sortOrder), asc(products.createdAt));
    return rows.map(toProductView);
  }

  async create(userId: string, dto: CreateProductDto): Promise<ProductView> {
    const profile = await this.vendors.requireProfileByUser(userId);
    const [row] = await this.db
      .insert(products)
      .values({
        vendorId: profile.id,
        nameAr: dto.nameAr,
        nameEn: dto.nameEn ?? null,
        descriptionAr: dto.descriptionAr ?? null,
        priceIqd: dto.priceIqd,
        section: dto.section ?? null,
        imageUrl: dto.imageUrl ?? null,
        isAvailable: dto.isAvailable,
        sortOrder: dto.sortOrder,
      })
      .returning();
    return toProductView(row);
  }

  async update(userId: string, productId: string, dto: UpdateProductDto): Promise<ProductView> {
    const profile = await this.vendors.requireProfileByUser(userId);

    const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
    if (dto.nameAr !== undefined) set.nameAr = dto.nameAr;
    if (dto.nameEn !== undefined) set.nameEn = dto.nameEn;
    if (dto.descriptionAr !== undefined) set.descriptionAr = dto.descriptionAr;
    if (dto.priceIqd !== undefined) set.priceIqd = dto.priceIqd;
    if (dto.section !== undefined) set.section = dto.section;
    if (dto.imageUrl !== undefined) set.imageUrl = dto.imageUrl;
    if (dto.isAvailable !== undefined) set.isAvailable = dto.isAvailable;
    if (dto.sortOrder !== undefined) set.sortOrder = dto.sortOrder;

    const [row] = await this.db
      .update(products)
      .set(set)
      .where(
        and(
          eq(products.id, productId),
          eq(products.vendorId, profile.id),
          eq(products.isDeleted, false),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
    return toProductView(row);
  }

  async softDelete(userId: string, productId: string): Promise<{ id: string; deleted: boolean }> {
    const profile = await this.vendors.requireProfileByUser(userId);
    const [row] = await this.db
      .update(products)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(products.id, productId),
          eq(products.vendorId, profile.id),
          eq(products.isDeleted, false),
        ),
      )
      .returning({ id: products.id });
    if (!row) throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND' });
    return { id: row.id, deleted: true };
  }
}
