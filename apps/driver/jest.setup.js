// المطابِقات (toBeOnTheScreen وأخواتها) مضمّنة في @testing-library/react-native
// منذ 12.4، فلا يلزم استيراد extend-expect.

// expo-router يقرأ سياق التوجيه من الجذر — الشاشات تُختبر منفردة بلا ذلك
// الجذر، فتُستبدل الملاحة بجواسيس تُتحقَّق منها في الاختبار.
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Link: 'Link',
  Stack: { Screen: 'Stack.Screen' },
  Redirect: 'Redirect',
}));
