import { useEffect, useRef, useState } from 'react';
import type { LogicalRange } from 'lightweight-charts';
import { fetchCandles } from '../api/client';
import type { Candle, CandlesResponse, Interval } from '../api/types';
import { connectKlineStream, klineStreamUrl } from '../realtime/binanceWs';
import { startLatestBarsPolling } from '../realtime/poll';
import { useChartStore } from '../store/chartStore';
import {
  applyRealtimeBar,
  applyTimeDisplay,
  createMainChart,
  prependBars,
  setBars,
  updateBar,
  type ChartHandles,
} from './series';

const PAGE_SIZE = 500;
const LOAD_MORE_THRESHOLD = 10;
const POLL_MS = 60_000;
const POLL_LIMIT = 3;

/** What the chart is currently showing; read by the dev-only E2E hook. */
interface LiveState {
  symbol: string;
  interval: Interval;
  bars: Candle[];
  loading: boolean;
  wsConnected: boolean;
  delayed: boolean;
  warning: string | null;
}

/** Data-source notes shown over the chart; `key` ties them to one symbol/interval. */
interface SourceInfo {
  key: string;
  delayed: boolean;
  warning: string | null;
  warningDismissed: boolean;
}

export function ChartView() {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const containerRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const liveRef = useRef<LiveState | null>(null);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const currentSource = source?.key === `${symbol}|${interval}` ? source : null;

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
            delayed: live?.delayed ?? false,
            warning: live?.warning ?? null,
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
    const key = `${symbol}|${interval}`;
    const live: LiveState = {
      symbol,
      interval,
      bars: [],
      loading: true,
      wsConnected: false,
      delayed: false,
      warning: null,
    };
    liveRef.current = live;
    let exhausted = false;
    let stopStream: (() => void) | null = null;
    let stopPolling: (() => void) | null = null;

    setBars(handles, []);
    applyTimeDisplay(handles.chart, interval);

    // `replaceWarning`: latest-data responses replace the note (null clears it); history pages
    // only add one (e.g. "range older than the source keeps"). A changed note shows again.
    let sourcePublished = false;
    const noteSource = (res: CandlesResponse, replaceWarning: boolean) => {
      const warning = replaceWarning ? res.warning : (res.warning ?? live.warning);
      const warningChanged = warning !== live.warning;
      if (sourcePublished && !warningChanged && res.delayed === live.delayed) return;
      sourcePublished = true;
      live.delayed = res.delayed;
      live.warning = warning;
      setSource((prev) => ({
        key,
        delayed: res.delayed,
        warning,
        warningDismissed: !warningChanged && prev?.key === key && prev.warningDismissed,
      }));
    };

    const loadOlder = (range: LogicalRange | null) => {
      if (!range || range.from > LOAD_MORE_THRESHOLD) return;
      if (live.loading || exhausted || live.bars.length === 0) return;
      live.loading = true;
      fetchCandles({ symbol, interval, end: live.bars[0].time, limit: PAGE_SIZE }, abort.signal)
        .then((res) => {
          if (abort.signal.aborted) return;
          noteSource(res, false);
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
        noteSource(res, true);
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
        } else {
          // No WebSocket for this source: refresh the latest bars periodically.
          stopPolling = startLatestBarsPolling({
            intervalMs: POLL_MS,
            fetchLatest: async (signal) => {
              const latest = await fetchCandles({ symbol, interval, limit: POLL_LIMIT }, signal);
              if (!signal.aborted) noteSource(latest, true);
              return latest.candles;
            },
            bars: () => live.bars,
            onBar: (bar) => updateBar(handles, bar),
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
      stopPolling?.();
    };
  }, [symbol, interval]);

  const showWarning = currentSource?.warning && !currentSource.warningDismissed;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="chart" className="h-full w-full" />
      {(currentSource?.delayed || showWarning) && (
        <div className="pointer-events-none absolute top-2 left-2 z-10 flex max-w-[60%] flex-col items-start gap-1 text-xs">
          {currentSource?.delayed && (
            <span
              data-testid="delayed-badge"
              title="Data from this source is delayed, not realtime"
              className="rounded border border-[#f9a825]/60 bg-[#131722]/90 px-1.5 py-0.5 font-medium text-[#f9a825]"
            >
              Delayed
            </span>
          )}
          {showWarning && (
            <div
              data-testid="data-warning"
              role="status"
              className="pointer-events-auto flex items-start gap-2 rounded border border-[#2a2e39] bg-[#1e222d]/95 px-2 py-1 text-[#d1d4dc]"
            >
              <span>{currentSource.warning}</span>
              <button
                type="button"
                aria-label="Dismiss warning"
                data-testid="data-warning-dismiss"
                onClick={() =>
                  setSource((prev) => (prev ? { ...prev, warningDismissed: true } : prev))
                }
                className="shrink-0 text-[#787b86] hover:text-[#d1d4dc]"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
