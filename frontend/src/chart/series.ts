import {
  CandlestickSeries,
  ColorType,
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
import type { Candle } from '../api/types';

const UP = '#26a69a';
const DOWN = '#ef5350';
const UP_VOLUME = 'rgba(38, 166, 154, 0.5)';
const DOWN_VOLUME = 'rgba(239, 83, 80, 0.5)';
const TIME_ZONE = 'Asia/Bangkok';

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23', ...options });
const crosshairFmt = fmt({
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const tickFmt: Record<TickMarkType, Intl.DateTimeFormat> = {
  [TickMarkType.Year]: fmt({ year: 'numeric' }),
  [TickMarkType.Month]: fmt({ month: 'short' }),
  [TickMarkType.DayOfMonth]: fmt({ day: 'numeric' }),
  [TickMarkType.Time]: fmt({ hour: '2-digit', minute: '2-digit' }),
  [TickMarkType.TimeWithSeconds]: fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' }),
};

// Data times are always UTC timestamps (seconds); only the display is converted.
const toDate = (time: Time) => new Date((time as number) * 1000);

export interface ChartHandles {
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  volume: ISeriesApi<'Histogram'>;
}

export function createMainChart(container: HTMLElement): ChartHandles {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#131722' },
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#1e222d' },
      horzLines: { color: '#1e222d' },
    },
    rightPriceScale: { borderColor: '#2a2e39' },
    timeScale: {
      borderColor: '#2a2e39',
      timeVisible: true,
      tickMarkFormatter: (time: Time, type: TickMarkType) => tickFmt[type].format(toDate(time)),
    },
    localization: { timeFormatter: (time: Time) => crosshairFmt.format(toDate(time)) },
  });

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    downColor: DOWN,
    borderUpColor: UP,
    borderDownColor: DOWN,
    wickUpColor: UP,
    wickDownColor: DOWN,
  });
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });

  const volume = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  return { chart, candles, volume };
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
