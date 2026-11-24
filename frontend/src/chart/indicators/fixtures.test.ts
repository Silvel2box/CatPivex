import { describe, expect, it } from 'vitest';
import { candlesOf, FIXTURES } from './fixtures/load';
import { dayKeyFor, INDICATORS, runIndicator } from './index';

describe('T3.1 indicators vs TA-Lib / pandas fixtures', () => {
  it('has the fixtures', () => {
    expect(FIXTURES.map((f) => f.name).sort()).toEqual(['aapl_5m', 'btcusdt_1h']);
  });

  for (const f of FIXTURES) {
    const bars = candlesOf(f);
    for (const c of f.cases) {
      it(`${f.name} ${c.type} ${JSON.stringify(c.params)} (${c.library})`, () => {
        const run = runIndicator(INDICATORS[c.type].calc, c.params, dayKeyFor(f.symbol), bars);
        expect(Object.keys(run.lines).sort()).toEqual(Object.keys(c.lines).sort());
        for (const [key, exp] of Object.entries(c.lines)) {
          const got = run.lines[key];
          // Same defined bars (first index and any gaps), then values within 1e-6.
          expect(got.map((p) => p.time)).toEqual(exp.index.map((i) => bars[i].time));
          expect(bars.findIndex((b) => b.time === got[0].time)).toBe(exp.index[0]);
          const maxErr = Math.max(...got.map((p, j) => Math.abs(p.value - exp.value[j])));
          expect(maxErr, `${key} max abs error`).toBeLessThanOrEqual(1e-6);
        }
      });
    }
  }

  it('aapl VWAP depends on the New York day (a UTC reset would differ)', () => {
    const f = FIXTURES.find((x) => x.name === 'aapl_5m')!;
    const bars = candlesOf(f);
    const ny = runIndicator(INDICATORS.vwap.calc, {}, dayKeyFor('US:AAPL'), bars).lines.value;
    const utc = runIndicator(INDICATORS.vwap.calc, {}, dayKeyFor('BINANCE:X'), bars).lines.value;
    expect(utc).not.toEqual(ny);
  });
});
