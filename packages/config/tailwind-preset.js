/**
 * رموز التصميم الموحدة: تستهلكها تطبيقات Expo عبر NativeWind
 * ولوحة الإدارة عبر Tailwind — لغة تصميم واحدة عبر المنصة.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fef7ee',
          100: '#fdecd7',
          200: '#fad5ae',
          300: '#f6b77b',
          400: '#f19045',
          500: '#ed7320',
          600: '#de5a16',
          700: '#b84414',
          800: '#933718',
          900: '#772f16',
        },
        // ألوان الحالات — لا تعتمد على اللون وحده (الملف §11)
        status: {
          pending: '#b45309',
          preparing: '#1d4ed8',
          ready: '#7c3aed',
          delivery: '#0e7490',
          delivered: '#15803d',
          cancelled: '#b91c1c',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8f7f5',
          dark: '#171412',
        },
      },
      fontFamily: {
        // تُحمَّل عبر expo-font في التطبيقات وnext/font في اللوحة
        sans: ['IBMPlexSansArabic', 'IBM Plex Sans Arabic', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        sheet: '24px',
      },
      minHeight: {
        touch: '44px', // أهداف اللمس ≥ 44×44 (الملف §11)
      },
      minWidth: {
        touch: '44px',
      },
    },
  },
};
