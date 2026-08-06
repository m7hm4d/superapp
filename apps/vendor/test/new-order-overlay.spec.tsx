import { render } from '@testing-library/react-native';
import type { NewOrderEvent } from '@superapp/shared';
import React from 'react';
import { NewOrderOverlay } from '../src/components/new-order-overlay';
import { useAlertStore } from '../src/stores/alert';
import { useAuthStore } from '../src/stores/auth';

const event = (): NewOrderEvent =>
  ({ eventId: 'e1', orderId: 'o1', itemsCount: 3, totalIqd: 12000 }) as unknown as NewOrderEvent;

const setAuthed = (authed: boolean) =>
  useAuthStore.setState({ status: authed ? 'authed' : 'anon' } as never);

beforeEach(() => {
  useAlertStore.setState({ pending: null, seenEventIds: [] });
  setAuthed(true);
});

describe('NewOrderOverlay', () => {
  it('لا يظهر بلا تنبيه معلّق', async () => {
    const { toJSON } = await render(<NewOrderOverlay />);
    expect(toJSON()).toBeNull();
  });

  it('يظهر بدور alert حين يصل طلب جديد', async () => {
    useAlertStore.setState({ pending: event(), seenEventIds: ['e1'] });
    const { getByRole } = await render(<NewOrderOverlay />);
    expect(getByRole('alert')).toBeTruthy();
  });

  /**
   * البائع غير المسجَّل لا يُنبَّه: التنبيه قد يصل من socket بقي مفتوحاً
   * لحظة الخروج، وعرضه فوق شاشة الدخول تسريب لبيانات طلب لا يملكها من يراها.
   */
  it('لا يظهر لمن ليس مسجّل الدخول ولو كان هناك تنبيه', async () => {
    useAlertStore.setState({ pending: event(), seenEventIds: ['e1'] });
    setAuthed(false);
    const { toJSON } = await render(<NewOrderOverlay />);
    expect(toJSON()).toBeNull();
  });
});
