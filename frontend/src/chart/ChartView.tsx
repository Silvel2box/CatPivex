import { useEffect, useRef } from 'react';
import type { LogicalRange } from 'lightweight-charts';
import { fetchCandles } from '../api/client';
import type { Candle, Interval } from '../api/types';
import { connectKlineStream, klineStreamUrl } from '../realtime/binanceWs';
import { useChartStore } from '../store/chartStore';
import {
  applyRealtimeBar,
  createMainChart,
  prependBars,
  setBars,
  updateBar,
  type ChartHandles,
} from './series';

const PAGE_SIZE = 500;
const LOAD_MORE_THRESHOLD = 10;

/** What the chart is currently showing; read by the dev-only E2E hook. */
interface LiveState {
  symbol: string;
  interval: Interval;
  bars: Candle[];
  loading: boolean;
  wsConnected: boolean;
}

export function ChartView() {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const liveRef = useRef<LiveState | null>(null);

  // Chart lifetime = component lifetime.
  useEffect(() => {
    const handles = createMainChart(containerRef.current!);
    handlesRef.current = handles;

    if (import.meta.env.DEV) {
      window.__catpivex = {
        state() {
          const live = liveRef.current;
          const data = handles.candles.data();
          return {
            symbol: live?.symbol ?? '',
            interval: live?.interval ?? '1m',
            barCount: data.length,
            firstTime: data.length ? (data[0].time as number) : null,
            lastBar: live?.bars[live.bars.length - 1] ?? null,
            loading: live?.loading ?? true,
            wsConnected: live?.wsConnected ?? false,
          };
        },
      };
    }

    return () => {
      if (import.meta.env.DEV) delete window.__catpivex;
      handlesRef.current = null;
      handles.chart.remove();
    };
  }, []);

  // Data + realtime for the current symbol/interval.
  useEffect(() => {
    const handles = handlesRef.current!;
    const timeScale = handles.chart.timeScale();
    const abort = new AbortController();
    const live: LiveState = { symbol, interval, bars: [], loading: true, wsConnected: false };
    liveRef.current = live;
    let exhausted = false;
    let stopStream: (() => void) | null = null;

    setBars(handles, []);

    const loadOlder = (range: LogicalRange | null) => {
      if (!range || range.from > LOAD_MORE_THRESHOLD) return;
      if (live.loading || exhausted || live.bars.length === 0) return;
      live.loading = true;
      fetchCandles({ symbol, interval, end: live.bars[0].time, limit: PAGE_SIZE }, abort.signal)
        .then((res) => {
          if (abort.signal.aborted) return;
          const merged = prependBars(live.bars, res.candles);
          if (merged.added === 0) {
            exhausted = true;
            return;
          }
          const visible = timeScale.getVisibleLogicalRange();
          live.bars = merged.bars;
          setBars(handles, live.bars);
          if (visible) {
            timeScale.setVisibleLogicalRange({
              from: visible.from + merged.added,
              to: visible.to + merged.added,
            });
          }
        })
        .catch((err: unknown) => {
          if (!abort.signal.aborted) console.error('Failed to load older candles', err);
        })
        .finally(() => {
          if (abort.signal.aborted) return;
          live.loading = false;
          // Still near the left edge (e.g. zoomed far out): keep loading.
          loadOlder(timeScale.getVisibleLogicalRange());
        });
    };

    fetchCandles({ symbol, interval, limit: PAGE_SIZE }, abort.signal)
      .then((res) => {
        if (abort.signal.aborted) return;
        live.bars = res.candles;
        exhausted = res.candles.length === 0;
        setBars(handles, live.bars);
        timeScale.scrollToPosition(0, false); // jump (no animation) to the latest bar

        const url = klineStreamUrl(symbol, interval);
        if (url) {
          stopStream = connectKlineStream(url, {
            onKline: ({ candle }) => {
              if (applyRealtimeBar(live.bars, candle)) updateBar(handles, candle);
            },
            onStatus: (connected) => {
              live.wsConnected = connected;
            },
          });
        }
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) console.error('Failed to load candles', err);
      })
      .finally(() => {
        if (!abort.signal.aborted) live.loading = false;
      });

    timeScale.subscribeVisibleLogicalRangeChange(loadOlder);

    return () => {
      abort.abort();
      // Skip if the chart was already removed (unmount runs the chart cleanup first).
      if (handlesRef.current === handles) timeScale.unsubscribeVisibleLogicalRangeChange(loadOlder);
      stopStream?.();
    };
  }, [symbol, interval]);

  return <div ref={containerRef} data-testid="chart" className="h-full w-full" />;
}
