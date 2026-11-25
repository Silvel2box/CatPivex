import {
  MAX_ALERT_NOTE,
  type Alert,
  type AlertCondition,
  type AlertCreate,
  type AlertUpdate,
} from '../api/types';

export const CONDITION_LABELS: Record<AlertCondition, string> = {
  crosses: 'Crossing',
  crosses_above: 'Crossing up',
  crosses_below: 'Crossing down',
  gte: 'Greater or equal',
  lte: 'Less or equal',
};

export interface AlertDraft {
  symbol: string;
  condition: AlertCondition;
  price: string;
  repeat: boolean;
  note: string;
}

export type DraftErrors = Partial<Record<'symbol' | 'price' | 'note', string>>;

/** Code points, like the backend's len(). */
export const noteLength = (note: string) => [...note].length;

const parsePrice = (text: string) => (text.trim() === '' ? NaN : Number(text));

export function newDraft(symbol: string, lastPrice: number | null): AlertDraft {
  return {
    symbol,
    condition: 'crosses',
    price: lastPrice === null ? '' : String(lastPrice),
    repeat: false,
    note: '',
  };
}

export function draftFromAlert(a: Alert): AlertDraft {
  return {
    symbol: a.symbol,
    condition: a.condition,
    price: String(a.price),
    repeat: a.repeat,
    note: a.note,
  };
}

/** `linked`: the price follows a line and is not checked. Empty object = valid. */
export function validateDraft(d: AlertDraft, linked = false): DraftErrors {
  const errors: DraftErrors = {};
  if (d.symbol.trim() === '') errors.symbol = 'Enter a symbol';
  if (!linked) {
    const price = parsePrice(d.price);
    if (!Number.isFinite(price) || price <= 0) errors.price = 'Price must be a number above 0';
  }
  if (noteLength(d.note) > MAX_ALERT_NOTE) {
    errors.note = `Note is too long (max ${MAX_ALERT_NOTE} characters)`;
  }
  return errors;
}

export function draftToCreate(d: AlertDraft): AlertCreate {
  return {
    symbol: d.symbol.trim(),
    condition: d.condition,
    price: parsePrice(d.price),
    repeat: d.repeat,
    note: d.note.trim(),
  };
}

export function draftToUpdate(d: AlertDraft, a: Alert): AlertUpdate {
  const patch: AlertUpdate = {};
  if (d.condition !== a.condition) patch.condition = d.condition;
  const price = parsePrice(d.price);
  if (a.drawing_id === null && price !== a.price) patch.price = price;
  if (d.repeat !== a.repeat) patch.repeat = d.repeat;
  const note = d.note.trim();
  if (note !== a.note) patch.note = note;
  return patch;
}

const bigFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const midFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const smallFmt = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });

// Same rule as backend services/alerts.py format_price.
export function formatAlertPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  const a = Math.abs(p);
  return (a >= 1000 ? bigFmt : a >= 1 ? midFmt : smallFmt).format(p);
}

const eventTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Unix seconds -> "24 Nov, 16:27:05" (Bangkok, like the chart). */
export const formatEventTime = (time: number) => eventTimeFmt.format(new Date(time * 1000));

export function deliveryStatus(
  deliveries: Record<string, string>,
): { channel: string; ok: boolean; detail: string }[] {
  return Object.entries(deliveries).map(([channel, status]) => ({
    channel,
    ok: status === 'ok',
    detail: status,
  }));
}
