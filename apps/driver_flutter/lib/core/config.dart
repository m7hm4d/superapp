/// عنوان الـAPI يُمرَّر وقت البناء لا يُخبَز في الشيفرة:
///   flutter run --dart-define=API_URL=https://api-stage.4irq.com
/// فتخدم نسخة واحدة بيئتَي التجربة والإنتاج.
const apiUrl = String.fromEnvironment(
  'API_URL',
  defaultValue: 'http://localhost:3000',
);
