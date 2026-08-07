/* eslint-disable no-console */
/**
 * يولّد نماذج Dart من `openapi.json`.
 *
 * كُتب بدل استعمال openapi-generator لأن أشكالنا بسيطة (كائنات بأوّليات
 * ومصفوفات وكائنات متداخلة)، والمولّد الرسمي يجرّ Java وقوالب ضخمة وناتجاً
 * لا يشبه ما نكتبه بأيدينا. مئة سطر هنا تعطي Dart اصطلاحياً نقرؤه ونثق به.
 *
 * الناتج **لا يُحرَّر يدوياً**: عدّل مخطط Zod وأعد التوليد. وفحص في CI
 * يقارن الناتج بالمحفوظ فيمنع الانحراف.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const OUT = join(ROOT, 'apps', 'driver_flutter', 'lib', 'core', 'generated_models.dart');

interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  nullable?: boolean;
  description?: string;
  anyOf?: JsonSchema[];
}

const doc = JSON.parse(readFileSync(join(ROOT, 'openapi.json'), 'utf8')) as {
  components: { schemas: Record<string, JsonSchema> };
};

/** يزيل غلاف anyOf الذي ينتجه `nullish()` ويعيد النوع الفعلي */
function unwrap(s: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  if (s.anyOf?.length) {
    const nonNull = s.anyOf.filter((a) => a.type !== 'null');
    return { schema: nonNull[0] ?? {}, nullable: nonNull.length !== s.anyOf.length };
  }
  if (Array.isArray(s.type)) {
    return { schema: { ...s, type: s.type.find((t) => t !== 'null') }, nullable: s.type.includes('null') };
  }
  return { schema: s, nullable: Boolean(s.nullable) };
}

/**
 * `#/components/schemas/DriverBatchStop` → `DriverBatchStop`
 *
 * يقبل المراجع التي تسمّي نموذجاً فقط. مرجع إلى خاصية داخل نموذج آخر
 * (`.../Batch/properties/id`) ليس نموذجاً، وقبوله كان يُنتج Dart لا يُصرَّف —
 * والصمت عنه أسوأ من السقوط.
 */
function refName(s: JsonSchema, models?: Set<string>): string | null {
  if (!s.$ref) return null;
  const m = /^#\/components\/schemas\/([^/]+)$/.exec(s.$ref);
  if (!m) throw new Error(`مرجع غير مدعوم: ${s.$ref}`);
  const name = m[1];
  if (models && !models.has(name)) throw new Error(`مرجع إلى نموذج غير معرَّف: ${name}`);
  return name;
}

function dartType(s: JsonSchema, models: Set<string>): string {
  const { schema } = unwrap(s);
  const ref = refName(schema, models);
  if (ref) return ref;
  switch (schema.type) {
    case 'string':
      return 'String';
    case 'integer':
      return 'int';
    case 'number':
      return 'double';
    case 'boolean':
      return 'bool';
    case 'array':
      return `List<${schema.items ? dartType(schema.items, models) : 'dynamic'}>`;
    case 'object':
      return 'Map<String, dynamic>';
    default:
      return 'dynamic';
  }
}

/** قارئ آمن: حقل ناقص أو نوع مخالف لا يُسقط التطبيق عند السائق */
function reader(field: string, s: JsonSchema, required: boolean): string {
  const { schema, nullable } = unwrap(s);
  const opt = !required || nullable;
  const src = `j['${field}']`;
  const ref = refName(schema);
  if (ref) {
    return opt
      ? `${src} == null ? null : ${ref}.fromJson(${src} as Map<String, dynamic>)`
      : `${ref}.fromJson((${src} as Map<String, dynamic>? ?? const {}))`;
  }
  switch (schema.type) {
    case 'string':
      return opt ? `${src} as String?` : `_str(${src})`;
    case 'integer':
      return opt ? `${src} is num ? (${src} as num).toInt() : null` : `_int(${src})`;
    case 'number':
      return opt ? `${src} is num ? (${src} as num).toDouble() : null` : `_dbl(${src})`;
    case 'boolean':
      return opt ? `${src} as bool?` : `${src} == true`;
    case 'array': {
      const item = schema.items ? unwrap(schema.items).schema : {};
      const itemRef = refName(item);
      if (itemRef) {
        return `((${src} as List?) ?? const []).cast<Map<String, dynamic>>().map(${itemRef}.fromJson).toList()`;
      }
      const t = schema.items ? dartType(schema.items, new Set()) : 'dynamic';
      return `((${src} as List?) ?? const []).cast<${t}>().toList()`;
    }
    default:
      return opt ? `${src} as Map<String, dynamic>?` : `(${src} as Map<String, dynamic>? ?? const {})`;
  }
}

const lines: string[] = [
  '// مولَّد — لا تحرّره.',
  '// المصدر: مخططات Zod في packages/shared، عبر openapi.json.',
  '// أعد التوليد: pnpm --filter @superapp/api gen:contract',
  '',
  'library;',
  '',
  'String _str(dynamic v) => v is String ? v : \'\';',
  'int _int(dynamic v) => v is num ? v.toInt() : 0;',
  'double _dbl(dynamic v) => v is num ? v.toDouble() : 0;',
  '',
];

const modelNames = new Set(Object.keys(doc.components.schemas));

for (const [name, schema] of Object.entries(doc.components.schemas)) {
  if (schema.type !== 'object' || !schema.properties) continue;
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(schema.properties);

  lines.push(`class ${name} {`);
  lines.push(`  const ${name}({`);
  for (const [f, s] of fields) {
    const opt = !required.has(f) || unwrap(s).nullable;
    lines.push(`    ${opt ? '' : 'required '}this.${f},`);
  }
  lines.push('  });', '');

  for (const [f, s] of fields) {
    const { nullable } = unwrap(s);
    const opt = !required.has(f) || nullable;
    if (s.description) lines.push(`  /// ${s.description}`);
    lines.push(`  final ${dartType(s, modelNames)}${opt ? '?' : ''} ${f};`);
  }
  lines.push('');

  lines.push(`  factory ${name}.fromJson(Map<String, dynamic> j) => ${name}(`);
  for (const [f, s] of fields) {
    lines.push(`        ${f}: ${reader(f, s, required.has(f))},`);
  }
  lines.push('      );', '');

  lines.push('  Map<String, dynamic> toJson() => {');
  for (const [f, s2] of fields) {
    const { schema: inner } = unwrap(s2);
    const r = refName(inner);
    const itemRef = inner.items ? refName(unwrap(inner.items).schema) : null;
    if (r && modelNames.has(r)) lines.push(`        '${f}': ${f}${required.has(f) ? '' : '?'}.toJson(),`);
    else if (itemRef && modelNames.has(itemRef)) lines.push(`        '${f}': ${f}.map((e) => e.toJson()).toList(),`);
    else lines.push(`        '${f}': ${f},`);
  }
  lines.push('      };');
  lines.push('}', '');
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`generated_models.dart written — ${modelNames.size} models`);
