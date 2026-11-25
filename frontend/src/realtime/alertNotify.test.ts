import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertEvent } from '../api/types';
import { useAlertStore } from '../store/alertStore';
import { notifyAlertEvent, requestAlertPermission } from './alertNotify';

const event: AlertEvent = {
  id: 3,
  alert_id: 1,
  symbol: 'SET:PTT',
  condition: 'gte',
  level: 35,
  price: 35.25,
  time: 0,
  message: 'SET:PTT >= 35',
  deliveries: {},
};

function stubNotification(permission: NotificationPermission) {
  const created: { title: string; options?: NotificationOptions }[] = [];
  const requestPermission = vi.fn(() => Promise.resolve(permission));
  class FakeNotification {
    static permission = permission;
    static requestPermission = requestPermission;
    constructor(title: string, options?: NotificationOptions) {
      created.push({ title, options });
    }
  }
  vi.stubGlobal('Notification', FakeNotification);
  return { created, requestPermission };
}

beforeEach(() => {
  useAlertStore.setState({ toasts: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T5 alert notifications', () => {
  it('granted: browser notification with symbol as title, message as body; no toast', () => {
    const { created } = stubNotification('granted');
    notifyAlertEvent(event);
    expect(created).toEqual([
      { title: 'SET:PTT', options: { body: 'SET:PTT >= 35', tag: 'catpivex-alert-3' } },
    ]);
    expect(useAlertStore.getState().toasts).toEqual([]);
  });

  it('denied: in-app toast instead', () => {
    const { created } = stubNotification('denied');
    notifyAlertEvent(event);
    expect(created).toEqual([]);
    expect(useAlertStore.getState().toasts).toMatchObject([
      { title: 'SET:PTT', body: 'SET:PTT >= 35' },
    ]);
  });

  it('asks for permission only while it is undecided', () => {
    const undecided = stubNotification('default');
    requestAlertPermission();
    expect(undecided.requestPermission).toHaveBeenCalledTimes(1);
    const denied = stubNotification('denied');
    requestAlertPermission();
    expect(denied.requestPermission).not.toHaveBeenCalled();
  });
});
