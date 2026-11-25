// Last close of the chart for form defaults, read on demand (no store update on every tick).

type Source = () => { symbol: string; price: number } | null;

let source: Source = () => null;

export function setLastPriceSource(fn: Source | null): void {
  source = fn ?? (() => null);
}

/** Last close when the chart shows `symbol`, else null. */
export function chartLastPrice(symbol: string): number | null {
  const v = source();
  return v && v.symbol === symbol ? v.price : null;
}
