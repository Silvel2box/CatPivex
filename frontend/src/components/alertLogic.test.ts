import { describe, expect, it } from 'vitest';
import { MAX_ALERT_NOTE, type Alert } from '../api/types';
import {
  deliveryStatus,
  draftFromAlert,
  draftToCreate,
  draftToUpdate,
  formatAlertPrice,
  formatEventTime,
  newDraft,
  validateDraft,
} from './alertLogic';

const base = newDraft('BINANCE:BTCUSDT', 65000.5);

const alert: Alert = {
  id: 1,
  symbol: 'BINANCE:BTCUSDT',
  condition: 'crosses',
  price: 100,
  repeat: false,
  enabled: true,
  drawing_id: null,
  note: '',
  created_at: 0,
  last_triggered_at: null,
};

describe('T5 alert form', () => {
  it('defaults: chart symbol, last price, crosses, repeat off', () => {
    expect(base).toEqual({
      symbol: 'BINANCE:BTCUSDT',
      condition: 'crosses',
      price: '65000.5',
      repeat: false,
      note: '',
    });
    expect(newDraft('X', null).price).toBe('');
    expect(validateDraft(base)).toEqual({});
  });

  it.each(['', '  ', 'abc', 'NaN', '0', '-5', 'Infinity'])('rejects price %j', (price) => {
    expect(validateDraft({ ...base, price }).price).toBeTruthy();
  });

  it('a linked alert skips the price check', () => {
    expect(validateDraft({ ...base, price: '' }, true)).toEqual({});
  });

  it('rejects a note longer than MAX_ALERT_NOTE, accepts exactly the max', () => {
    expect(validateDraft({ ...base, note: 'x'.repeat(MAX_ALERT_NOTE + 1) }).note).toBeTruthy();
    expect(validateDraft({ ...base, note: 'x'.repeat(MAX_ALERT_NOTE) })).toEqual({});
  });

  it('rejects an empty symbol', () => {
    expect(validateDraft({ ...base, symbol: ' ' }).symbol).toBeTruthy();
  });

  it('draftToCreate parses the price and trims', () => {
    expect(draftToCreate({ ...base, symbol: ' SET:PTT ', note: ' hi ' })).toEqual({
      symbol: 'SET:PTT',
      condition: 'crosses',
      price: 65000.5,
      repeat: false,
      note: 'hi',
    });
  });

  it('draftToUpdate sends only changed fields and never a linked price', () => {
    const d = draftFromAlert(alert);
    expect(draftToUpdate(d, alert)).toEqual({});
    expect(draftToUpdate({ ...d, price: '120', repeat: true }, alert)).toEqual({
      price: 120,
      repeat: true,
    });
    const linked = { ...alert, drawing_id: 'd-1' };
    expect(draftToUpdate({ ...d, price: '120', condition: 'gte' }, linked)).toEqual({
      condition: 'gte',
    });
  });

  it('history helpers: Bangkok time, delivery status per channel', () => {
    expect(formatEventTime(Date.UTC(2026, 10, 24, 9, 27, 5) / 1000)).toBe('24 Nov, 16:27:05');
    expect(deliveryStatus({ telegram: 'ok', line: 'error: 401' })).toEqual([
      { channel: 'telegram', ok: true, detail: 'ok' },
      { channel: 'line', ok: false, detail: 'error: 401' },
    ]);
  });
});

describe('formatAlertPrice (same cases as backend test_format_price)', () => {
  it.each([
    [59429.724018, '59,429.72'],
    [354.19000244, '354.19'],
    [32.4875, '32.4875'],
    [33.9, '33.90'],
    [1, '1.00'],
    [0.5678, '0.5678'],
    [0.5, '0.5'],
    [0.00001234, '0.00001234'],
  ])('%s -> %s', (value, text) => {
    expect(formatAlertPrice(value)).toBe(text);
  });
});
