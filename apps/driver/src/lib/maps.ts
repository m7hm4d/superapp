import { Linking, Platform } from 'react-native';

/** فتح تطبيق الخرائط الخارجي على وجهة (لا ملاحة داخلية في الـMVP) */
export function openExternalMaps(lat: number, lng: number, label?: string): void {
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}${label ? `(${encodeURIComponent(label)})` : ''}`;
  void Linking.openURL(url);
}

/** اتصال هاتفي — الرقم مقنّع من الخادم، نمرره كما هو (القناة المحمية P1) */
export function openPhone(phoneMasked: string): void {
  const digits = phoneMasked.replace(/[^\d+]/g, '');
  if (!digits) return;
  void Linking.openURL(`tel:${digits}`);
}
