import { describe, expect, it } from 'vitest';
import {
  DOWN_COLOR,
  NEUTRAL_COLOR,
  UP_COLOR,
  formatChangePercent,
  formatPrice,
  splitSymbol,
} from './quoteFormat';

describe('T2.9b formatChangePercent', () => {
  it('positive: plus sign, 2 decimals, up colour', () => {
    expect(formatChangePercent(1.234)).toEqual({ text: '+1.23%', color: UP_COLOR });
  });

  it('negative: minus sign, down colour', () => {
    expect(formatChangePercent(-0.5)).toEqual({ text: '-0.50%', color: DOWN_COLOR });
  });

  it('zero (and values that round to zero): neutral, no sign', () => {
    expect(formatChangePercent(0)).toEqual({ text: '0.00%', color: NEUTRAL_COLOR });
    expect(formatChangePercent(-0.001)).toEqual({ text: '0.00%', color: NEUTRAL_COLOR });
  });

  it('null / non-finite: dash, neutral', () => {
    expect(formatChangePercent(null)).toEqual({ text: '—', color: NEUTRAL_COLOR });
    expect(formatChangePercent(NaN)).toEqual({ text: '—', color: NEUTRAL_COLOR });
  });
});

describe('T2.9b formatPrice / splitSymbol', () => {
  it('formats prices and shows a dash for null', () => {
    expect(formatPrice(86050.555)).toBe('86,050.56');
    expect(formatPrice(34.5)).toBe('34.50');
    expect(formatPrice(0.0012345)).toBe('0.001235');
    expect(formatPrice(null)).toBe('—');
  });

  it('splits exchange and ticker', () => {
    expect(splitSymbol('SET:PTT')).toEqual({ ticker: 'PTT', exchange: 'SET' });
    expect(splitSymbol('PLAIN')).toEqual({ ticker: 'PLAIN', exchange: '' });
  });
});
