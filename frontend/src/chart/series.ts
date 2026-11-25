import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  TickMarkType,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Interval } from '../api/types';

const UP = '#26a69a';
const DOWN = '#ef5350';
const UP_VOLUME = 'rgba(38, 166, 154, 0.5)';
const DOWN_VOLUME = 'rgba(239, 83, 80, 0.5)';
const TIME_ZONE = 'Asia/Bangkok';

const fmt = (timeZone: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', ...options });

// Data times are always UTC timestamps (seconds); only the display is converted.
const toDate = (time: Time) => new Date((time as number) * 1000);

export interface TimeFormatters {
  tick: (time: Time, type: TickMarkType) => string;
  crosshair: (time: Time) => string;
}

function makeFormatters(timeZone: string, withTime: boolean): TimeFormatters {
  const crosshairFmt = fmt(timeZone, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
  const tickFmt: Record<TickMarkType, Intl.DateTimeFormat> = {
    [TickMarkType.Year]: fmt(timeZone, { year: 'numeric' }),
    [TickMarkType.Month]: fmt(timeZone, { month: 'short' }),
    [TickMarkType.DayOfMonth]: fmt(timeZone, { day: 'numeric' }),
    [TickMarkType.Time]: fmt(timeZone, { hour: '2-digit', minute: '2-digit' }),
    [TickMarkType.TimeWithSeconds]: fmt(timeZone, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
  return {
    tick: (time, type) => tickFmt[type].format(toDate(time)),
    crosshair: (time) => crosshairFmt.format(toDate(time)),
  };
}

const INTRADAY_FORMATTERS = makeFormatters(TIME_ZONE, true);
// 1D/1W bars are stamped 00:00 UTC of the trading date: show that date, not Bangkok 07:00.
const DAILY_FORMATTERS = makeFormatters('UTC', false);

export function timeFormatters(interval: Interval): TimeFormatters {
  return interval === '1D' || interval === '1W' ? DAILY_FORMATTERS : INTRADAY_FORMATTERS;
}

/** Switch the time axis / crosshair labels to suit `interval`. */
export function applyTimeDisplay(chart: IChartApi, interval: Interval): void {
  const f = timeFormatters(interval);
  chart.applyOptions({
    timeScale: { tickMarkFormatter: f.tick },
    localization: { timeFormatter: f.crosshair },
  });
}

export interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
}

const CANDLE_MARGINS_WITH_VOLUME = { top: 0.1, bottom: 0.25 };
const CANDLE_MARGINS = { top: 0.1, bottom: 0.1 };

export function createMainChart(container: HTMLElement): ChartHandles {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#131722' },
      textColor: '#d1d4dc',
      panes: { separatorColor: '#2a2e39' },
      // The licence's tradingview.com link is shown under the watchlist instead (Watchlist.tsx).
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' },
    },
    // Default is Magnet (horizontal line sticks to the close); follow the cursor like TradingView.
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: {
      borderColor: '#2a2e39',
      timeVisible: true,
      tickMarkFormatter: INTRADAY_FORMATTERS.tick,
    },
    localization: { timeFormatter: INTRADAY_FORMATTERS.crosshair },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderUpColor: UP,
    borderDownColor: DOWN,
    wickUpColor: UP,
    wickDownColor: DOWN,
  });
  candles.priceScale().applyOptions({ scaleMargins: CANDLE_MARGINS_WITH_VOLUME });

  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  return { chart, candles, volume };
}

/** Show/hide the volume histogram; candles take the freed space. */
export function setVolumeVisible({ candles, volume }: ChartHandles, visible: boolean): void {
  volume.applyOptions({ visible });
  candles
    .priceScale()
    .applyOptions({ scaleMargins: visible ? CANDLE_MARGINS_WITH_VOLUME : CANDLE_MARGINS });
}

export function toCandleData(c: Candle): CandlestickData {
  return { time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close };
}

export function toVolumeData(c: Candle): HistogramData {
  return {
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? UP_VOLUME : DOWN_VOLUME,
  };
}

export function setBars({ candles, volume }: ChartHandles, bars: Candle[]): void {
  candles.setData(bars.map(toCandleData));
  volume.setData(bars.map(toVolumeData));
}

export function updateBar({ candles, volume }: ChartHandles, bar: Candle): void {
  candles.update(toCandleData(bar));
  volume.update(toVolumeData(bar));
}

/** Prepend older history to `bars`, dropping anything not strictly older than `bars[0]`. */
export function prependBars(bars: Candle[], older: Candle[]): { bars: Candle[]; added: number } {
  const first = bars[0]?.time ?? Infinity;
  const byTime = new Map<number, Candle>();
  for (const c of older) if (c.time < first) byTime.set(c.time, c);
  const fresh = [...byTime.values()].sort((a, b) => a.time - b.time);
  return { bars: [...fresh, ...bars], added: fresh.length };
}

/** Apply a realtime bar in place (replace last or append). Returns false if it is older than the last bar. */
export function applyRealtimeBar(bars: Candle[], bar: Candle): boolean {
  const last = bars[bars.length - 1];
  if (last && bar.time < last.time) return false;
  if (last && bar.time === last.time) bars[bars.length - 1] = bar;
  else bars.push(bar);
  return true;
}
