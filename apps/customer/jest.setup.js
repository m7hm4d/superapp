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

// zustand/persist يكتب عبر AsyncStorage — نسخة في الذاكرة تكفي وتبقى معزولة
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.get(k) ?? null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
  };
});
