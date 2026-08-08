import { z } from 'zod';
import { Role, VehicleType, VendorCategory } from '../enums';
import { zIraqiPhone, zLatLng, zPassword } from './common';

export const zRegisterCustomer = z.object({
  role: z.literal(Role.CUSTOMER),
  phone: zIraqiPhone,
  password: zPassword,
  fullName: z.string().min(2).max(100),
});

export const zRegisterVendor = z.object({
  role: z.literal(Role.VENDOR),
  phone: zIraqiPhone,
  password: zPassword,
  fullName: z.string().min(2).max(100),
  storeNameAr: z.string().min(2).max(120),
  category: z.nativeEnum(VendorCategory),
  location: zLatLng,
  addressText: z.string().min(2).max(300),
});

export const zRegisterDriver = z.object({
  role: z.literal(Role.DRIVER),
  phone: zIraqiPhone,
  password: zPassword,
  fullName: z.string().min(2).max(100),
  vehicleType: z.nativeEnum(VehicleType),
});

export const zRegister = z.discriminatedUnion('role', [
  zRegisterCustomer,
  zRegisterVendor,
  zRegisterDriver,
]);
export type RegisterInput = z.infer<typeof zRegister>;

export const zLogin = z.object({
  phone: zIraqiPhone,
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof zLogin>;

export const zRefresh = z.object({
  /**
   * الحدّ الأعلى قبل التحقق التشفيري لا بعده: بلا سقف يدخل نصٌّ مهما طال
   * إلى فكّ JWT، فيصير المسار مضخّة عمل مجانية. رمزنا نحو 300 محرف،
   * والسقف واسع لكل زيادة معقولة في الحمولة.
   */
  refreshToken: z.string().min(20).max(1024),
});

export const zAdminLogin = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
  /** بديل TOTP عند ضياع الجهاز — استعمال واحد */
  recoveryCode: z.string().min(8).max(64).optional(),
});

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  phone: string;
  fullName: string;
  role: Role;
  approvalStatus?: string;
}

/**
 * تغيير كلمة مرور الإدارة.
 *
 * الحالية **إلى جانب** العامل الثاني لا بدلاً منه: من جلس إلى جهاز مفتوح
 * لا يعرف الحالية، ومن سرق الحالية لا يملك الجهاز. وأيّهما وحده كافٍ
 * لاختطاف الحساب لو قُبل منفرداً.
 */
export const zAdminChangePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: zPassword,
  /** رمز TOTP أو رمز استرداد — أحدهما مطلوب */
  totp: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(64).optional(),
});
export type AdminChangePasswordInput = z.infer<typeof zAdminChangePassword>;

/** توليد رموز استرداد جديدة — يُبطل ما سبق */
export const zAdminRecoveryRegenerate = z.object({
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/),
});
export type AdminRecoveryRegenerateInput = z.infer<typeof zAdminRecoveryRegenerate>;

