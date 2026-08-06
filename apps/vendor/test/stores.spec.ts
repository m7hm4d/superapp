import type { NewOrderEvent } from '@superapp/shared';
import { useAlertStore } from '../src/stores/alert';
import { useApprovalStore } from '../src/stores/approval';

const event = (eventId: string): NewOrderEvent =>
  ({ eventId, orderId: `o-${eventId}` }) as unknown as NewOrderEvent;

beforeEach(() => {
  useAlertStore.setState({ pending: null, seenEventIds: [] });
  useApprovalStore.getState().clear();
});

describe('تنبيه الطلب الجديد', () => {
  it('يرفع التنبيه المعلّق', () => {
    useAlertStore.getState().push(event('e1'));
    expect(useAlertStore.getState().pending?.eventId).toBe('e1');
  });

  /**
   * الـsocket يعيد الإرسال عند إعادة الاتصال. بلا الـdedup يقفز التنبيه
   * ويهتزّ الجهاز مرة أخرى لطلب أقرّ به البائع فعلاً.
   */
  it('يتجاهل الحدث نفسه إذا تكرر', () => {
    const { push } = useAlertStore.getState();
    push(event('e1'));
    useAlertStore.getState().dismiss();
    push(event('e1'));
    expect(useAlertStore.getState().pending).toBeNull();
  });

  it('يقبل حدثاً جديداً بعد الإخفاء', () => {
    useAlertStore.getState().push(event('e1'));
    useAlertStore.getState().dismiss();
    useAlertStore.getState().push(event('e2'));
    expect(useAlertStore.getState().pending?.eventId).toBe('e2');
  });

  /** ذاكرة الأحداث مقصوصة عند خمسين — بلا القص تنمو بلا حدّ في جلسة طويلة */
  it('يحتفظ بآخر خمسين معرّفاً فقط', () => {
    const { push } = useAlertStore.getState();
    for (let i = 0; i < 60; i++) push(event(`e${i}`));
    const seen = useAlertStore.getState().seenEventIds;
    expect(seen).toHaveLength(50);
    expect(seen).toContain('e59');
    expect(seen).not.toContain('e0');
  });

  it('يعيد قبول حدث سقط من الذاكرة', () => {
    const { push } = useAlertStore.getState();
    for (let i = 0; i < 60; i++) push(event(`e${i}`));
    useAlertStore.getState().dismiss();
    push(event('e0'));
    expect(useAlertStore.getState().pending?.eventId).toBe('e0');
  });
});

describe('علم انتظار الموافقة', () => {
  it('يرفع العلم مع الحالة والسبب', () => {
    useApprovalStore.getState().setBlocked({ status: 'rejected', reason: 'سجل ناقص' });
    const s = useApprovalStore.getState();
    expect(s.blocked).toBe(true);
    expect(s.status).toBe('rejected');
    expect(s.reason).toBe('سجل ناقص');
  });

  it('يرفع العلم حتى بلا تفاصيل', () => {
    useApprovalStore.getState().setBlocked({});
    expect(useApprovalStore.getState().blocked).toBe(true);
    expect(useApprovalStore.getState().status).toBeUndefined();
  });

  /** المسح يجب أن يزيل التفاصيل أيضاً، وإلا ظهر سبب رفض قديم بعد الموافقة */
  it('يمسح العلم والتفاصيل معاً', () => {
    useApprovalStore.getState().setBlocked({ status: 'suspended', reason: 'مخالفة' });
    useApprovalStore.getState().clear();
    const s = useApprovalStore.getState();
    expect(s.blocked).toBe(false);
    expect(s.status).toBeUndefined();
    expect(s.reason).toBeUndefined();
  });
});
