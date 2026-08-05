import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ApprovalStatus,
  CATEGORY_FLAG_BY_CATEGORY,
  FeatureFlagKey,
  NearbyQuery,
  ProductView,
  VendorCardView,
  VendorCategory,
  zSetOpen,
  zUpdateVendorProfile,
} from '@superapp/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DB, DbClient } from '../../db/drizzle.module';
import { featureFlags, products, vendorProfiles } from '../../db/schema';

export type UpdateVendorProfileDto = z.infer<typeof zUpdateVendorProfile>;
export type SetOpenDto = z.infer<typeof zSetOpen>;

type VendorProfileRow = typeof vendorProfiles.$inferSelect;
type ProductRow = typeof products.$inferSelect;

export interface VendorProfileView {
  id: string;
  userId: string;
  cityId: string;
  storeNameAr: string;
  storeNameEn: string | null;
  category: VendorCategory;
  lat: number;
  lng: number;
  addressText: string;
  isOpen: boolean;
  openingHours: string | null;
  defaultPrepMinutes: number;
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  createdAt: Date;
}

export interface VendorPublicView {
  vendor: Omit<VendorCardView, 'distanceM'>;
  products: ProductView[];
  catalogVersion: number;
}

export function toProductView(row: ProductRow): ProductView {
  return {
    id: row.id,
    vendorId: row.vendorId,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    descriptionAr: row.descriptionAr,
    priceIqd: row.priceIqd,
    section: row.section,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
    imageUrl: row.imageUrl,
  };
}

@Injectable()
export class VendorsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /** الفئات المفعّلة عبر feature_flags (غياب الصف = معطّلة) */
  private async enabledCategories(): Promise<Set<VendorCategory>> {
    const keys: FeatureFlagKey[] = Object.values(CATEGORY_FLAG_BY_CATEGORY);
    const rows = await this.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(inArray(featureFlags.key, keys));
    const enabledKeys = new Set(rows.filter((r) => r.enabled).map((r) => r.key));

    const enabled = new Set<VendorCategory>();
    for (const [category, flagKey] of Object.entries(CATEGORY_FLAG_BY_CATEGORY) as [
      VendorCategory,
      FeatureFlagKey,
    ][]) {
      if (enabledKeys.has(flagKey)) enabled.add(category);
    }
    return enabled;
  }

  async findNearby(query: NearbyQuery): Promise<VendorCardView[]> {
    const enabled = await this.enabledCategories();

    let categories: VendorCategory[];
    if (query.category) {
      if (!enabled.has(query.category)) return [];
      categories = [query.category];
    } else {
      categories = [...enabled];
      if (categories.length === 0) return [];
    }

    const origin = sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography`;
    const distanceM = sql<number>`ST_Distance(${vendorProfiles.location}, ${origin})`;

    const rows = await this.db
      .select({
        id: vendorProfiles.id,
        storeNameAr: vendorProfiles.storeNameAr,
        category: vendorProfiles.category,
        isOpen: vendorProfiles.isOpen,
        lat: sql<number>`ST_Y(${vendorProfiles.location}::geometry)`,
        lng: sql<number>`ST_X(${vendorProfiles.location}::geometry)`,
        distanceM,
        addressText: vendorProfiles.addressText,
        defaultPrepMinutes: vendorProfiles.defaultPrepMinutes,
      })
      .from(vendorProfiles)
      .where(
        and(
          eq(vendorProfiles.approvalStatus, ApprovalStatus.APPROVED),
          inArray(vendorProfiles.category, categories),
          sql`ST_DWithin(${vendorProfiles.location}, ${origin}, ${query.radius})`,
        ),
      )
      .orderBy(desc(vendorProfiles.isOpen), distanceM)
      .limit(query.limit);

    return rows.map((r) => ({
      id: r.id,
      storeNameAr: r.storeNameAr,
      category: r.category,
      isOpen: r.isOpen,
      lat: Number(r.lat),
      lng: Number(r.lng),
      distanceM: Math.round(Number(r.distanceM)),
      addressText: r.addressText,
      defaultPrepMinutes: r.defaultPrepMinutes,
    }));
  }

  async getPublicVendor(id: string): Promise<VendorPublicView> {
    const [vendor] = await this.db
      .select({
        id: vendorProfiles.id,
        storeNameAr: vendorProfiles.storeNameAr,
        category: vendorProfiles.category,
        isOpen: vendorProfiles.isOpen,
        lat: sql<number>`ST_Y(${vendorProfiles.location}::geometry)`,
        lng: sql<number>`ST_X(${vendorProfiles.location}::geometry)`,
        addressText: vendorProfiles.addressText,
        defaultPrepMinutes: vendorProfiles.defaultPrepMinutes,
      })
      .from(vendorProfiles)
      .where(
        and(eq(vendorProfiles.id, id), eq(vendorProfiles.approvalStatus, ApprovalStatus.APPROVED)),
      )
      .limit(1);

    if (!vendor) throw new NotFoundException({ code: 'VENDOR_NOT_FOUND' });

    const productRows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.vendorId, id), eq(products.isDeleted, false)))
      .orderBy(asc(products.sortOrder), asc(products.createdAt));

    const [version] = await this.db
      .select({
        epoch: sql<string | null>`extract(epoch from max(${products.updatedAt}))`,
      })
      .from(products)
      .where(eq(products.vendorId, id));

    const catalogVersion =
      version?.epoch === null || version?.epoch === undefined
        ? 0
        : Math.floor(Number(version.epoch));

    return {
      vendor: {
        id: vendor.id,
        storeNameAr: vendor.storeNameAr,
        category: vendor.category,
        isOpen: vendor.isOpen,
        lat: Number(vendor.lat),
        lng: Number(vendor.lng),
        addressText: vendor.addressText,
        defaultPrepMinutes: vendor.defaultPrepMinutes,
      },
      products: productRows.map(toProductView),
      catalogVersion,
    };
  }

  /** ملف البائع من userId — 404 NO_PROFILE عند الغياب */
  async requireProfileByUser(userId: string): Promise<VendorProfileRow> {
    const [profile] = await this.db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, userId))
      .limit(1);
    if (!profile) throw new NotFoundException({ code: 'NO_PROFILE' });
    return profile;
  }

  async getOwnProfile(userId: string): Promise<VendorProfileView> {
    const profile = await this.requireProfileByUser(userId);
    return this.toProfileView(profile);
  }

  async updateOwnProfile(userId: string, dto: UpdateVendorProfileDto): Promise<VendorProfileView> {
    const profile = await this.requireProfileByUser(userId);

    const set: Partial<typeof vendorProfiles.$inferInsert> = {};
    if (dto.storeNameAr !== undefined) set.storeNameAr = dto.storeNameAr;
    if (dto.addressText !== undefined) set.addressText = dto.addressText;
    if (dto.location !== undefined) set.location = { lat: dto.location.lat, lng: dto.location.lng };
    if (dto.defaultPrepMinutes !== undefined) set.defaultPrepMinutes = dto.defaultPrepMinutes;
    if (dto.openingHours !== undefined) set.openingHours = dto.openingHours;

    if (Object.keys(set).length === 0) return this.toProfileView(profile);

    const [updated] = await this.db
      .update(vendorProfiles)
      .set(set)
      .where(eq(vendorProfiles.id, profile.id))
      .returning();
    return this.toProfileView(updated);
  }

  async setOpen(userId: string, dto: SetOpenDto): Promise<{ id: string; isOpen: boolean }> {
    const profile = await this.requireProfileByUser(userId);
    const [updated] = await this.db
      .update(vendorProfiles)
      .set({ isOpen: dto.isOpen })
      .where(eq(vendorProfiles.id, profile.id))
      .returning({ id: vendorProfiles.id, isOpen: vendorProfiles.isOpen });
    return updated;
  }

  private toProfileView(p: VendorProfileRow): VendorProfileView {
    return {
      id: p.id,
      userId: p.userId,
      cityId: p.cityId,
      storeNameAr: p.storeNameAr,
      storeNameEn: p.storeNameEn,
      category: p.category,
      lat: p.location.lat,
      lng: p.location.lng,
      addressText: p.addressText,
      isOpen: p.isOpen,
      openingHours: p.openingHours,
      defaultPrepMinutes: p.defaultPrepMinutes,
      approvalStatus: p.approvalStatus,
      rejectionReason: p.rejectionReason,
      createdAt: p.createdAt,
    };
  }
}
