export const UP_COLOR = '#26a69a';
export const DOWN_COLOR = '#ef5350';
export const NEUTRAL_COLOR = '#787b86';

const priceFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const smallPriceFmt = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 });

/** Last price: 2 decimals, 4 significant digits below 1, "—" when unknown. */
export function formatPrice(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return '—';
  return Math.abs(price) >= 1 ? priceFmt.format(price) : smallPriceFmt.format(price);
}

/** Change % with sign and colour: "+1.23%" up, "-1.23%" down, "0.00%" / "—" neutral. */
export function formatChangePercent(pct: number | null): { text: string; color: string } {
  if (pct === null || !Number.isFinite(pct)) return { text: '—', color: NEUTRAL_COLOR };
  const rounded = Math.round(pct * 100) / 100;
  if (rounded === 0) return { text: '0.00%', color: NEUTRAL_COLOR };
  return rounded > 0
    ? { text: `+${rounded.toFixed(2)}%`, color: UP_COLOR }
    : { text: `${rounded.toFixed(2)}%`, color: DOWN_COLOR };
}

/** "SET:PTT" -> { ticker: "PTT", exchange: "SET" }. */
export function splitSymbol(symbol: string): { ticker: string; exchange: string } {
  const i = symbol.indexOf(':');
  return i < 0
    ? { ticker: symbol, exchange: '' }
    : { ticker: symbol.slice(i + 1), exchange: symbol.slice(0, i) };
}
