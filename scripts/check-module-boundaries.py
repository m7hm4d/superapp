#!/usr/bin/env python3
"""يمنع وحدةً من لمس جدول لا تملكه.

اليوم لا حدود في طبقة البيانات: ثلاثة عشر جدولاً من واحد وعشرين تلمسه أكثر
من وحدة، و``vendorProfiles`` وحده تلمسه سبع من ثمان. النتيجة أن تغيير عمود
واحد يستلزم قراءة المشروع كله، وأن أي تقسيم لاحق إلى خدمات يصطدم بأن
البيانات مشاعة.

الفحص لا يُصلح ذلك دفعةً واحدة — يُثبّته. يبدأ بقائمة استثناءات تضمّ الخروق
القائمة فيمرّ اليوم، ثم تُفرَّغ استثناءً استثناءً. وما دامت القائمة مقفلة،
لا يُضاف خرق جديد بلا أن يسقط البناء.

الملكية في ``scripts/module-ownership.json`` — سطر واحد لكل جدول.

    python3 scripts/check-module-boundaries.py            فحص
    python3 scripts/check-module-boundaries.py --update   تحديث الاستثناءات
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OWNERSHIP = os.path.join(ROOT, 'scripts', 'module-ownership.json')
BASELINE = os.path.join(ROOT, 'scripts', 'module-boundaries-baseline.json')
API_SRC = os.path.join(ROOT, 'apps', 'api', 'src')

# ‏import { a, b } from '.../db/schema'
SCHEMA_IMPORT = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'[^']*db/schema'", re.S)


def module_of(path: str) -> str | None:
    """اسم الوحدة من مسار الملف — أو None لما هو خارج الوحدات."""
    rel = os.path.relpath(path, API_SRC).replace(os.sep, '/')
    parts = rel.split('/')
    if parts[0] == 'modules' and len(parts) > 2:
        return parts[1]
    # ‏common والبنية التحتية تُعامل كوحدة واحدة اسمها common
    if parts[0] in ('common', 'db', 'config'):
        return 'common'
    # ‏realtime وغيرها: تُحاسَب باسمها
    return parts[0]


def violations() -> list[tuple[str, str, str]]:
    """(الوحدة، الجدول، الملف) لكل لمسة جدول غير مملوك."""
    owners = json.load(open(OWNERSHIP, encoding='utf-8'))['owners']
    found: set[tuple[str, str, str]] = set()

    for path in glob.glob(os.path.join(API_SRC, '**', '*.ts'), recursive=True):
        rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
        # المخطط نفسه والهجرات والبذر: تعريفات لا استهلاك
        if '/db/schema' in rel or '/db/migrations' in rel or '/db/seed' in rel:
            continue
        module = module_of(path)
        if module is None:
            continue
        source = open(path, encoding='utf-8').read()
        for match in SCHEMA_IMPORT.finditer(source):
            for raw in match.group(1).split(','):
                table = raw.strip().removeprefix('type ').strip()
                if not table or table not in owners:
                    continue
                if owners[table] != module:
                    found.add((module, table, rel))
    return sorted(found)


def load_baseline() -> set[tuple[str, str, str]]:
    if not os.path.exists(BASELINE):
        return set()
    return {tuple(entry) for entry in json.load(open(BASELINE, encoding='utf-8'))['allowed']}


def main() -> int:
    current = violations()
    baseline = load_baseline()

    if '--update' in sys.argv:
        json.dump(
            {
                '_': 'خروق قائمة يُسمح بها مؤقتاً. تُفرَّغ ولا تُملأ — كل سطر يُحذف تقدّم.',
                'allowed': [list(v) for v in current],
            },
            open(BASELINE, 'w', encoding='utf-8'),
            indent=2,
            ensure_ascii=False,
        )
        print(f'حُدِّثت القائمة: {len(current)} خرقاً مسموحاً.')
        return 0

    new = [v for v in current if v not in baseline]
    fixed = [v for v in baseline if v not in set(current)]

    for module, table, path in new:
        print(f'{path}: وحدة «{module}» تلمس «{table}» ولا تملكه — نادِ وحدته بدل الاستعلام المباشر.')

    if new:
        print(f'\n{len(new)} خرقاً جديداً. الملكية في scripts/module-ownership.json.')
        return 1

    # خرق أُصلح ولم يُشطب من القائمة: القائمة تُفرَّغ لا تتضخّم
    if fixed:
        print(f'{len(fixed)} خرقاً في القائمة لم يعد قائماً — شغّل --update لشطبه.')
        return 1

    remaining = len(current)
    if remaining:
        print(f'لا خرق جديد. باقٍ {remaining} خرقاً في قائمة الاستثناءات.')
    else:
        print('لا خرق. كل وحدة تلمس جداولها وحدها.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
