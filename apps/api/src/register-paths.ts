/**
 * tsc لا يعيد كتابة أسماء المسارات (@superapp/shared) في الناتج المجمَّع،
 * فبدون هذا الـ hook يحلّها Node إلى مصدر TS الخام داخل node_modules.
 * يجب أن يبقى أول استيراد في main.ts.
 */
import * as fs from 'node:fs';
import Module from 'node:module';
import * as path from 'node:path';

const compiledSharedRoot = path.join(__dirname, '../../../packages/shared/src');

if (fs.existsSync(path.join(compiledSharedRoot, 'index.js'))) {
  const moduleAny = Module as unknown as {
    _resolveFilename: (request: string, ...rest: unknown[]) => string;
  };
  const original = moduleAny._resolveFilename;
  moduleAny._resolveFilename = function (request: string, ...rest: unknown[]): string {
    if (request === '@superapp/shared') {
      return original.call(this, path.join(compiledSharedRoot, 'index.js'), ...rest);
    }
    if (request.startsWith('@superapp/shared/')) {
      return original.call(
        this,
        path.join(compiledSharedRoot, request.slice('@superapp/shared/'.length)),
        ...rest,
      );
    }
    return original.call(this, request, ...rest);
  };
}
