#!/usr/bin/env python3
"""يمنع حقن الأوامر عبر تعابير GitHub داخل كتل ``run:``.

توسعة ``${{ ... }}`` تقع **قبل** تشغيل الصدفة: تُلصق القيمة نصّاً في السكربت،
فإن حملت ``$(...)`` أو ``;`` أو سطراً جديداً صارت أمراً يُنفَّذ. واسم الوسم
يختاره من يستطيع إنشاء وسم، و``git check-ref-format`` يقبل ``refs/tags/v$(id)``
بلا اعتراض — وقد كان ``publish.yml`` يمرّره إلى ``cosign verify`` على runner
يملك ``packages:write`` و``id-token:write``.

العلاج أن تمرّ القيم عبر ``env:`` ثم تُقتبس: ``"${VAR}"`` تبقى نصّاً لا يُعاد
تقييمه. هذا الفحص يفرض ذلك بدل الاعتماد على الانتباه في كل مراجعة.
"""

from __future__ import annotations

import glob
import re
import sys

EXPRESSION = re.compile(r"\$\{\{\s*([^}]+?)\s*\}\}")
RUN_KEY = re.compile(r"^\s*-?\s*run:")


def offences(path: str) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    in_run = False
    run_indent = 0
    for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        if RUN_KEY.match(line):
            in_run = True
            run_indent = indent
            # ‏run: cosign ... ${{ }} على سطر واحد يُفحص هنا لا في التالي
            found += [(number, m.group(1)) for m in EXPRESSION.finditer(line)]
            continue
        if not in_run:
            continue
        # سطر فارغ لا ينهي الكتلة — الكتل المطوية تحوي فراغات
        if stripped and indent <= run_indent:
            in_run = False
            continue
        found += [(number, m.group(1)) for m in EXPRESSION.finditer(line)]
    return found


def main() -> int:
    total = 0
    for path in sorted(glob.glob(".github/workflows/*.yml") + glob.glob(".github/workflows/*.yaml")):
        for number, expression in offences(path):
            print(f"{path}:{number}: تعبير داخل run: — مرّره عبر env ثم اقتبسه: {{{{ {expression} }}}}")
            total += 1
    if total:
        print(f"\n{total} موضعاً. القيمة تُلصق نصّاً في السكربت قبل تشغيله، فتصير $() أمراً.")
        return 1
    print("لا تعابير GitHub داخل كتل run:.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
