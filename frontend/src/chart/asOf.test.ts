import { describe, expect, it } from 'vitest';
import { asOfTitle, formatAsOf } from './asOf';

describe('T2.14 delayed "as of" time', () => {
  it('shows the bar time in Bangkok time (UTC+7) with the date', () => {
    // 2026-11-24 09:27 UTC = 16:27 in Bangkok.
    expect(formatAsOf(Date.UTC(2026, 10, 24, 9, 27) / 1000)).toBe('24 Nov, 16:27');
    // 2026-11-24 20:10 UTC = 03:10 on the 25th in Bangkok: the date follows Bangkok.
    expect(formatAsOf(Date.UTC(2026, 10, 24, 20, 10) / 1000)).toBe('25 Nov, 03:10');
  });

  it('tooltip has the full date and when it was checked', () => {
    const t = asOfTitle(Date.UTC(2026, 10, 24, 9, 27) / 1000, Date.UTC(2026, 10, 24, 9, 42, 5));
    expect(t).toContain('Tue, 24 Nov 2026, 16:27 (Bangkok)');
    expect(t).toContain('Checked at 16:42:05');
    expect(asOfTitle(null, 0)).toContain('no data yet');
  });
});
