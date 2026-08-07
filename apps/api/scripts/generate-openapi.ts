/* eslint-disable no-console */
/**
 * يولّد `openapi.json` من مخططات Zod في `packages/shared`.
 *
 * المخططات هي مصدر الحقيقة الوحيد: الخادم يتحقق بها، وTypeScript يشتقّ
 * أنواعه منها، ومن هذا الملف تُولَّد نماذج Dart. فما دام العقد يتغيّر في
 * مكان واحد، لا يمكن أن ينحرف طرف عن طرف بصمت.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as shared from '@superapp/shared';

/** ما يُصدَّر إلى العقد. الاسم هنا يصير اسم النموذج في Dart. */
const MODELS: Record<string, z.ZodTypeAny> = {
  BatchStop: shared.zBatchStopView,
  DriverBatchStop: shared.zDriverBatchStop,
  Batch: shared.zBatchView,
  DriverBatch: shared.zDriverBatchView,
  DriverLedger: shared.zDriverLedger,
  ConfirmPickupRequest: shared.zConfirmPickup,
  ConfirmDeliveryRequest: shared.zConfirmDelivery,
  ReportExceptionRequest: shared.zReportException,
  SetAvailabilityRequest: shared.zSetAvailability,
};

/** المسارات التي تستهلكها تطبيقات الهاتف اليوم */
const PATHS = {
  '/driver/batches/available': {
    get: { summary: 'العروض المتاحة', response: 'DriverBatch', array: true },
  },
  '/driver/batches/active': {
    get: { summary: 'الدفعة النشطة أو لا شيء', response: 'DriverBatch', nullable: true },
  },
  '/driver/batches/{id}/claim': {
    post: { summary: 'قبول دفعة (ذرّي)', response: 'DriverBatch' },
  },
  '/driver/batches/{id}/confirm-pickup': {
    post: {
      summary: 'تأكيد الاستلام من المخبز',
      request: 'ConfirmPickupRequest',
      response: 'DriverBatch',
    },
  },
  '/driver/orders/{orderId}/deliver': {
    post: { summary: 'تسليم طلب وتحصيل نقده', request: 'ConfirmDeliveryRequest' },
  },
  '/driver/orders/{orderId}/exception': {
    post: { summary: 'تسجيل تعذّر تسليم', request: 'ReportExceptionRequest' },
  },
  '/driver/ledger': {
    get: { summary: 'دفتر السائق المالي', response: 'DriverLedger' },
  },
  '/driver/availability': {
    patch: { summary: 'الاتصال للعمل', request: 'SetAvailabilityRequest' },
  },
} as const;

/** ترتيب المفاتيح ليصير التوقيع مستقلاً عن ترتيب الكتابة */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, val]) => [k, sortKeys(val)]),
  );
}

function schemas(): Record<string, unknown> {
  // تحويل **دفعة واحدة** بخريطة تعريفات: تحويل كل مخطط منفرداً يجعل
  // المولّد جاهلاً ببقية النماذج، فيُدمج الكائن المتداخل في مكانه ويفقد
  // هويته — ويخرج في Dart كـMap<String,dynamic> بدل نموذجه.
  //
  // ‏`as never` مقصود: استدلال zodToJsonSchema على مخططاتنا المتشعّبة
  // يتجاوز حدّ عمق المصرّف (TS2589). الناتج JSON يُفحص بمقارنته بالملف
  // المحفوظ في CI لا بالأنواع.
  //
  // ‏`$refStrategy: 'none'` لازم مع `definitions`: بدونه يُلغي المولّد تكرار
  // **أي** مخطط متطابق — حتى الأوّليات — فيشير `id` إلى
  // `BatchStop/properties/orderId` لأن كليهما `zUuid`. النتيجة نماذج Dart
  // حقولها Map ومصانعها بلا معنى. مع `none` تُسطَّح الأوّليات ويبقى المرجع
  // للنماذج المسمّاة وحدها.
  const json = zodToJsonSchema(z.object({}) as never, {
    definitions: MODELS as never,
    $refStrategy: 'none',
    target: 'openApi3',
  }) as { definitions?: Record<string, unknown> };

  const defs = (json.definitions ?? {}) as Record<string, Record<string, unknown>>;

  // ‏`$refStrategy: 'none'` يسطّح النماذج المتداخلة أيضاً، فتفقد `stops`
  // هويتها. نعيد ربطها بمطابقة الشكل: كائن مُسطَّح يطابق نموذجاً مسمّى
  // يُستبدل بمرجع إليه. المطابقة على النص المرتَّب لا على المرجع، فهي
  // دقيقة ولا تخلط نموذجين مختلفين.
  const fingerprint = (v: unknown): string => JSON.stringify(sortKeys(v));
  const byShape = new Map<string, string>();
  for (const [name, schema] of Object.entries(defs)) byShape.set(fingerprint(schema), name);

  const relink = (node: unknown, selfName: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => relink(n, selfName));
    if (!node || typeof node !== 'object') return node;
    const hit = byShape.get(fingerprint(node));
    // لا نستبدل النموذج بمرجع إلى نفسه
    if (hit && hit !== selfName) return { $ref: `#/components/schemas/${hit}` };
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, relink(v, selfName)]),
    );
  };

  return Object.fromEntries(
    Object.entries(defs).map(([name, schema]) => [
      name,
      Object.fromEntries(
        Object.entries(schema).map(([k, v]) => [k, k === 'properties' ? relink(v, name) : v]),
      ),
    ]),
  );
}

function paths(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, methods] of Object.entries(PATHS)) {
    const entry: Record<string, unknown> = {};
    for (const [method, spec] of Object.entries(methods)) {
      const s = spec as {
        summary: string;
        request?: string;
        response?: string;
        array?: boolean;
        nullable?: boolean;
      };
      const responseSchema = s.response
        ? s.array
          ? { type: 'array', items: { $ref: `#/components/schemas/${s.response}` } }
          : { $ref: `#/components/schemas/${s.response}` }
        : { type: 'object' };

      entry[method] = {
        summary: s.summary,
        security: [{ bearerAuth: [] }],
        ...(s.request
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${s.request}` },
                  },
                },
              },
            }
          : {}),
        responses: {
          '200': {
            description: s.nullable ? 'قد تكون فارغة' : 'نجاح',
            content: { 'application/json': { schema: responseSchema } },
          },
        },
      };
    }
    out[path] = entry;
  }
  return out;
}

const doc = {
  openapi: '3.0.3',
  info: {
    title: 'SuperApp API — عقد تطبيقات الهاتف',
    version: '0.1.0',
    description:
      'مولَّد من مخططات Zod في packages/shared. لا يُحرَّر يدوياً — عدّل المخطط وأعد التوليد.',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: schemas(),
  },
  paths: paths(),
};

// جذر المستودع مهما كان مجلد التشغيل
const out = join(__dirname, '..', '..', '..', 'openapi.json');
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`openapi.json written — ${Object.keys(doc.components.schemas).length} models, ${Object.keys(doc.paths).length} paths`);
