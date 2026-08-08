# النسخ الاحتياطي والتعافي من الكوارث

تاريخ المراجعة: 2026-08-08

## الحالة والهدف

ينفذ هذا الفرع نسخة PostgreSQL محلية قبل كل هجرة، مع حد عدد ومساحة يفشل مغلقاً قبل امتلاء القرص. لا توجد بعد نسخة خارج VPS، ولا S3 bucket، ولا schedule، ولا حذف retention آلي، ولا restore drill مثبت. لذلك حالة التعافي الخارجية هي `DESIGNED / NOT ENABLED`.

الهدف بعد تنفيذ الخطة واختبارها هو:

```text
RPO target: 24 hours
RTO target for the latest 35 daily backups in S3 Standard: 2 hours
```

هذان هدفان وليسا ضماناً. نقاط Glacier لها RTO منفصل يعتمد على فئة التخزين وخيار الاسترجاع ولا تدخل في هدف الساعتين. لا تصبح الأهداف مؤكدة إلا بعد قياس restore drill كامل لكل tier مستخدم، ثم إعادة القياس ربع سنوي وعند تغيير PostgreSQL أو PostGIS أو مخطط البيانات.

## ما يعمل الآن

يشغل `deploy/deploy.sh` الملف التالي قبل migration دائماً:

```text
deploy/backup-db.sh
```

السكربت:

- يحدد حاوية DB واحدة من labels الخاصة بـCompose و`STACK_NAME`، ولا يخمن بالاسم.

- ينفذ `pg_dump --format=custom --no-owner --no-acl` من داخل حاوية PostgreSQL العاملة.

- يرفض الملف الفارغ ويتحقق أن ترويسة الأرشيف وجدول محتوياته قابلان للقراءة بواسطة `pg_restore --list` قبل اعتماد اسمه النهائي. هذا لا يقرأ كل data block ولا يثبت الاستعادة الكاملة.

- يحسب SHA-256 ويحفظ ملف `.sha256` بجانب النسخة.

- يستخدم `umask 077` ومجلداً بصلاحية `0700` وملفات بصلاحية `0600`.

- يقيس حجم قاعدة البيانات والمساحة الحرة ويطلب هامشاً يعادل ضعف الحجم مع `512 MiB` إضافية.

- يدوّر النسخ المحلية عند تجاوز `MAX_LOCAL_BACKUPS`، وقيمته الافتراضية 30: بعد اكتمال نسخة جديدة والتحقق من فهرستها فقط تُحذف الأقدم فالأقدم حتى يعود العدد إلى الحد، ويُسجل كل حذف في stderr. لا تُحذف نسخة قط قبل وجود بديل أحدث سليم، ويبقى النقل خارج الخادم واختبار restore مسؤولية تشغيلية مستقلة لا يعوضها الاحتفاظ المحلي.

المسار المحلي الافتراضي هو:

```text
.deploy/backups/<stack>/
```

إذا ضُبط `DEPLOY_STATE_DIR` إلى مسار مطلق ثابت، يصبح المسار `${DEPLOY_STATE_DIR}/backups/<stack>/`. هذا مطلوب عند تشغيل release bundles متبدلة كي تبقى النسخ والسجل والأقفال خارج مجلد الإصدار المؤقت.

[PostgreSQL 17: pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html)

هذه النسخة تحمي من فشل نشر قريب فقط. تبقى على القرص والخادم نفسيهما، ولا تحمي من حذف VPS أو تلف القرص أو ransomware أو فقدان الحساب. لا يحذف السكربت نسخاً آلياً؛ وعند بلوغ الحد يوقف النشر حتى تنقل نسخة خارج الخادم وتثبت الاستعادة ثم تنظف القديم وفق السياسة.

في النشر الأول بلا حاوية أو volume، ينشئ قاعدة فارغة ويأخذ dump صالحاً قبل migration. إذا وجد volume بلا حاوية سابقة يفشل ولا يسمح لـCompose الجديد بلمس البيانات؛ يلزم عندها backup أو استعادة يدوية أولاً.

## الأصول التي يجب حمايتها

1. قاعدة PostgreSQL/PostGIS، وهي الأصل الأساسي المثبت في التصميم الحالي.

2. ملف environment وأي إعدادات Caddy أو أسرار تشغيل لازمة لإعادة البناء، لكن تحفظ كأرشيف مشفر من جهة العميل ولا تُرفع كنص صريح.

3. release manifest يحوي source SHA ووسمي الصور وRepoDigests وتوقيت النسخة وإصداري PostgreSQL/PostGIS، بلا أسرار.

4. الملفات المرفوعة من المستخدمين إن أضيف تخزين ملفات دائم مستقبلاً. لا يوجد في التدقيق الحالي دليل على volume تطبيق دائم يجب نسخه؛ عند إضافة الميزة يجب تحديث هذه الخطة قبل الإنتاج.

صور التطبيق نفسها لا تُنسخ إلى S3؛ GHCR والـdigests وسجل الإصدار هما المصدر، مع إمكان إعادة البناء من commit موثوق عند الضرورة.

## تصميم S3 المقترح

لا يُنشأ أي مورد حتى تفعيل MFA للجذر، وإنشاء هوية إدارية غير جذرية، والموافقة على الميزانية. بعد ذلك ينشأ bucket مخصص في `eu-north-1` بالخصائص التالية:

- تفعيل Block Public Access على مستوى bucket والحساب، وعدم استخدام ACLs، وضبط Object Ownership إلى Bucket owner enforced.

- تفعيل Versioning قبل أول upload.

- تفعيل default encryption بـSSE-S3 لتجنب رسم KMS key شهري غير مبرر في هذه المرحلة. إذا فرضت سياسة امتثال customer-managed KMS key، يعاد حساب الكلفة وتفصل صلاحيات المفتاح.

- bucket policy ترفض أي طلب لا يستخدم TLS عبر الشرط `aws:SecureTransport=false`.

- منع الوصول العام كلياً، وعدم إنشاء presigned public URLs للنسخ.

- prefixes منفصلة للإنتاج والتجربة ونوع النسخة، مثل `production/postgres/daily/`، من دون Account ID أو أسرار في أسماء الملفات.

[Amazon S3: default encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html)

[Amazon S3: Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)

[Amazon S3: require TLS with bucket policy](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html)

SSE-S3 يحمي البيانات على وسائط S3، لكنه لا يجعل ملف أسرار مكشوفاً آمناً لكل من يملك صلاحية القراءة. لذلك يشفر أرشيف environment من جهة العميل بواسطة `age` أو GPG لمفتاح استعادة منفصل قبل upload، ولا تحفظ private decryption key على VPS أو في GitHub.

يمكن اعتماد S3 Object Lock بوضع Governance بعد تجربة الاستعادة وموافقة المالك على إجراءات الحذف والطوارئ. لا يفعّل تلقائياً في المرحلة الأولى؛ سوء ضبط retention قد يمنع حذف بيانات حساسة أو يرفع الكلفة. Versioning وleast privilege يظلان إلزاميين.

[Amazon S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html)

## الصلاحيات

بعد تسجيل VPS كعقدة SSM hybrid، تمنح هوية النسخ اليومية القدرة التالية فقط:

```text
s3:PutObject -> exact production backup prefix
```

لا تمنحها `s3:GetObject` أو `s3:DeleteObject` أو `s3:ListAllMyBuckets`. إذا احتاج upload متعدد الأجزاء، تضاف أفعاله المحددة إلى bucket نفسه فقط. تستعمل بيانات role مؤقتة، لا access key دائم.

دور الاستعادة البشري منفصل عبر IAM Identity Center وMFA. يقرأ النسخ والـversions المحددة ولا يكتب التطبيق أو يدير bucket policy. مسؤول bucket والإزالة الطارئة role ثالث عند الحاجة.

لا ينشأ GitHub OIDC role لهذه النسخ، لأن المصدر هو VPS لا GitHub Actions. لا توضع activation code أو AWS keys أو decryption key في repository secrets.

## الجدول والاحتفاظ المقترحان

بعد تنفيذ upload automation واختبارها:

- نسخة يومية تبقى 35 يوماً في S3 Standard.

- نسخة أسبوعية تبقى 13 أسبوعاً. يمكن وضعها في Glacier Flexible Retrieval من البداية أو وفق lifecycle يحترم مدة التخزين الدنيا البالغة 90 يوماً.

- نسخة شهرية تبقى 12 شهراً، ويمكن استخدام Glacier Deep Archive مع احترام مدة التخزين الدنيا البالغة 180 يوماً.

- نسخة قبل كل نشر تبقى محلياً مؤقتاً. الحاجز الحالي يفحص المساحة ويوقف النسخ عند 30 ملفاً افتراضياً لكنه لا يحذف شيئاً. بعد التحقق من upload الخارجي، تنفذ سياسة تحتفظ بآخر ثلاث نسخ محلية على الأقل أو سبعة أيام، أيهما أوسع، ولا تحذف آخر نسخة سليمة.

لا تنقل نسخة يومية إلى فئة لها حد أدنى أطول ثم تحذفها قبل الحد؛ رسوم الحد الأدنى تستمر. تستخدم prefixes أو tags منفصلة للنسخ اليومية والأسبوعية والشهرية حتى تكون lifecycle صريحة.

[Amazon S3 lifecycle management](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)

[Amazon S3 storage-class transition constraints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html)

## upload والتحقق المقترحان

الأتمتة المستقبلية يجب أن تتوقف عند أي فشل، ولا تحذف النسخة المحلية قبل إثبات الآتي:

1. نجاح `pg_dump` وقراءة جدول المحتويات بواسطة `pg_restore --list` وحساب SHA-256 محلياً، مع بقاء الاستعادة المعزولة الدورية هي إثبات restoreability.

2. upload عبر TLS إلى bucket وprefix المتوقعين مع encryption وmetadata غير سرية.

3. مطابقة checksum الذي أعاده `PutObject` مع checksum المحلي من هوية VPS write-only. لا تمنح عملية الرفع `HeadObject` أو `GetObjectAttributes` بصمت.

4. تسجيل نجاح timestamp وحجم object وchecksum وsource release في log مراقب، بلا passwords أو environment values.

5. إرسال تنبيه عند غياب نسخة ناجحة خلال 26 ساعة، أو فشل الرفع، أو انخفاض مساحة VPS.

لا توجد هذه الأتمتة الآن. ينفذ دور الاستعادة/التحقق المنفصل دورياً `HeadObject` أو `GetObjectAttributes` أو تنزيل عينة كاملة، ثم يطابق checksum ويثبت قابلية القراءة؛ هذه الصلاحية لا تمنح لهوية VPS اليومية. لا يجوز كتابة dashboard يفترض نجاح النسخ من مجرد خروج cron؛ الدليل هو object حديث قابل للقراءة بدور الاستعادة.

## restore drill ربع سنوي

ينفذ الاختبار في stack معزولة وvolume وقاعدة جديدين، ولا يعيد الكتابة فوق production أبداً.

1. اختر restore point موثقاً، وسجل incident/drill ID والموافق والزمن المتوقع.

2. استخدم دور الاستعادة البشري لتنزيل النسخة والـmanifest والchecksum إلى مضيف معزول. إذا كان أرشيف الإعدادات مشفراً من جهة العميل، يفك عبر مفتاح الاستعادة خارج VPS.

3. تحقق من SHA-256 قبل فتح الأرشيف، ثم شغل:

```bash
pg_restore --list backup.dump >/dev/null
```

4. أنشئ PostgreSQL 17 وPostGIS major مطابقين لنقطة النسخة. لا تستعد مباشرة إلى قاعدة أقدم غير مدعومة.

5. استعد إلى قاعدة فارغة، مع إيقاف العملية عند أول خطأ:

```bash
pg_restore \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname superapp_restore \
  backup.dump
```

6. شغل migrations المطلوبة من release متوافق، ثم health checks للتطبيق المعزول.

7. قارن row counts للجداول الحرجة، وتحقق من قيود schema وامتداد PostGIS وعينة auth وإجراء قراءة وكتابة غير إنتاجي.

8. سجل زمن التنزيل والاستعادة والتحقق، والـRPO الفعلي، والـRTO الفعلي، وأي خطوة يدوية أو خطأ.

9. دمر stack الاختبار وفق عملية معتمدة بعد حفظ التقرير، ولا تحتفظ بنسخة مفكوكة التشفير بلا حاجة.

نجاح `pg_restore --list` يثبت أن ترويسة الأرشيف وجدول محتوياته مقروءان؛ لا يقرأ كل data block ولا يثبت صحة كل صف أو قدرة التطبيق على العمل. لذلك يستخدم drill `pg_restore --single-transaction --exit-on-error` على قاعدة معزولة، ثم health checks واستعلامات sanity، قبل وصف النسخة بأنها قابلة للاستعادة.

## rollback ليس restore

عودة التطبيق في `deploy.sh` تعيد صورتي API وAdmin السابقتين بالـdigest ولا تعكس migration. إذا كانت migration غير متوافقة مع الإصدار السابق، قد تفشل العودة حتى مع صور سليمة.

قاعدة الإصدار هي expand/contract:

1. أضف schema جديداً متوافقاً ولا تحذف القديم.

2. انشر تطبيقاً يستطيع التعامل مع المرحلتين، وانقل البيانات وراقبها.

3. احذف القديم في إصدار لاحق بعد نافذة عودة متفق عليها.

لا تستعد قاعدة production تلقائياً عند فشل تطبيق. الاستعادة قد تفقد معاملات أحدث من restore point، ولذلك تحتاج قرار incident owner أو DBA، وإيقاف الكتابة، وتحديد RPO المقبول، وحفظ النسخة الحالية قبل أي تغيير.

## تشغيل حادث فعلي

1. أعلن الحادث وأوقف النشر، وحدد هل الخلل application فقط أم data corruption أو loss.

2. إذا كانت البيانات سليمة، حاول العودة إلى الـdigests السابقة واترك DB كما هي.

3. إذا كان تلف البيانات مرجحاً، أوقف الكتابة، وخذ forensic snapshot أو dump إن أمكن، ولا تستبدل آخر نسخة سليمة.

4. اختر restore point بناءً على checksums وسجل النسخ، واستعد أولاً في بيئة معزولة.

5. بعد موافقة المالك على فقد البيانات بين restore point والحادث، بدّل الخدمة بخطة DNS/edge واضحة ونفذ فحوص الصحة والمصادقة.

6. احتفظ بالسجلات والتوقيتات واكتب post-incident review يحدّث RPO وRTO والسياسات.

## المراقبة

المؤشرات القابلة للتصرف بعد تفعيل CloudWatch هي:

- عمر آخر نسخة محلية وآخر object خارجي ناجح.

- فشل `pg_dump` أو فهرسة الأرشيف أو checksum أو upload.

- نسبة استعمال القرص وinodes في VPS.

- عدد objects وحجم التخزين حسب prefix، مع إنذار نمو غير متوقع.

- فشل restore drill أو تجاوز ساعتين.

SSM hybrid وCloudWatch وSNS كلها مقترحة وغير مفعّلة. تفاصيل المراقبة والتكلفة في `docs/AWS_ARCHITECTURE.md`.

## التكلفة الشهرية التخطيطية

الافتراض هو 1 GB مضغوط يومياً، مع نسخ يومية وأسبوعية وشهرية وإجمالي مستقر يقارب 40 إلى 80 GB. عند هذا الحجم، S3 والتخزين والطلبات تقديرها نحو:

```text
1-3 USD/month
```

يزداد الرقم خطياً تقريباً مع حجم النسخة وعدد النسخ، وتضاف رسوم retrieval وrestore وdata transfer في الحادث. Glacier لها حدود تخزين دنيا، وقد يولد الحذف المبكر رسوماً. يجب إدخال الأحجام والطلبات والفئة والمنطقة الفعلية في AWS Pricing Calculator قبل الإنشاء.

[Amazon S3 pricing](https://aws.amazon.com/s3/pricing/)

التكلفة الإضافية الحالية من هذه الخطة هي `0 USD/month` لأنه لم ينشأ bucket ولم يحدث upload.

## ترتيب التفعيل

1. فعّل MFA للجذر وأنشئ هوية IAM Identity Center غير جذرية.

2. أنشئ Budget وتنبيهات Cost Anomaly قبل bucket.

3. أنشئ bucket الخاص واختبر policy وencryption وversioning بدورين منفصلين.

4. أضف upload automation بلا delete، واختبر checksum والتنبيه وغياب الأسرار في logs.

5. نفذ restore drill معزولاً وقس RPO وRTO.

6. فعّل lifecycle، ثم تنظيف النسخ المحلية مع disk guard.

7. راجع الحجم والكلفة بعد أسبوع وشهر، ثم drill كل ربع سنة.

حتى إكمال الخطوة الخامسة لا يوصف النظام بأنه يملك disaster recovery مؤكداً.
