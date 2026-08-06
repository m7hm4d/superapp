import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { BatchCard } from '../src/components/BatchCard';
import type { DriverBatchView } from '../src/types';

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

const batch = (over: Partial<DriverBatchView> = {}): DriverBatchView =>
  ({
    id: 'b1',
    vendorNameAr: 'مخبز الكرادة',
    ordersCount: 2,
    totalFeeIqd: 4000,
    totalCashIqd: 26000,
    offerExpiresAt: inSeconds(90),
    ...over,
  }) as DriverBatchView;

describe('BatchCard', () => {
  it('يعرض اسم المخبز والمبلغين', async () => {
    const { getByText } = await render(<BatchCard batch={batch()} />);
    expect(getByText('مخبز الكرادة')).toBeTruthy();
    // المبالغ بأرقام لاتينية وفواصل آلاف كما في بقية الشاشات
    expect(getByText(/4,000/)).toBeTruthy();
    expect(getByText(/26,000/)).toBeTruthy();
  });

  it('يعدّ تنازلياً ما دام العرض قائماً', async () => {
    const { getByText } = await render(<BatchCard batch={batch({ offerExpiresAt: inSeconds(90) })} />);
    expect(getByText(/01:30/)).toBeTruthy();
  });

  /**
   * جوهر البطاقة: عرض منتهٍ لا يُقبل. لو بقي قابلاً للضغط لأرسل السائق طلب
   * قبول يرفضه الخادم — فيرى خطأً بدل أن يُمنع من المحاولة أصلاً.
   *
   * التحقق عبر دور الوصول لا عبر استدعاء onPress: fireEvent في RNTL يمشي
   * على العناصر المركّبة أيضاً، فيجد الخاصية على BatchCard نفسه ويستدعيها
   * وإن لم تصل إلى Card — فيمرّ اختبار لا يقيس شيئاً.
   */
  it('لا يعرض العرض المنتهي كعنصر قابل للضغط', async () => {
    const { queryByRole, getByText } = await render(
      <BatchCard batch={batch({ offerExpiresAt: inSeconds(-5) })} onPress={jest.fn()} />,
    );
    expect(queryByRole('button')).toBeNull();
    expect(getByText('انتهت المهلة')).toBeTruthy();
  });

  it('يعرض العرض القائم كعنصر قابل للضغط', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <BatchCard batch={batch({ offerExpiresAt: inSeconds(90) })} onPress={onPress} />,
    );
    const button = getByRole('button');
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
