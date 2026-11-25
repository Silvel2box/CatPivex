import { useEffect, useRef, useState } from 'react';
import type { LogicalRange, MouseEventParams, UTCTimestamp } from 'lightweight-charts';
import { fetchCandles } from '../api/client';
import { INTERVAL_SECONDS, type Candle, type CandlesResponse, type Interval } from '../api/types';
import { connectKlineStream, klineStreamUrl } from '../realtime/binanceWs';
import { startLatestBarsPolling, startPolling } from '../realtime/poll';
import { alertLineIds, useAlertStore } from '../store/alertStore';
import { useChartStore } from '../store/chartStore';
import { useDrawingStore } from '../store/drawingStore';
import { useIndicatorStore } from '../store/indicatorStore';
import { asOfTitle, formatAsOf } from './asOf';
import { DrawingController } from './drawings/controller';
import { DrawingsPrimitive } from './drawings/DrawingsPrimitive';
import { buildLegend, withHiddenSources } from './indicatorData';
import { INDICATORS } from './indicators';
import { IndicatorLayer } from './indicatorSeries';
import { setLastPriceSource } from './lastPrice';
import { Legend, createLegendFeed } from './Legend';
import {
  applyRealtimeBar,
  applyTimeDisplay,
  createMainChart,
  prependBars,
  setBars,
  setVolumeVisible,
  updateBar,
  type ChartHandles,
} from './series';

const PAGE_SIZE = 500;
const LOAD_MORE_THRESHOLD = 10;
const POLL_MS = 60_000;
const POLL_LIMIT = 3;
/** How often the "Delayed · as of" time is refreshed (the newest 1m bar of the symbol). */
const AS_OF_POLL_MS = 60_000;

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
  const layerRef = useRef<IndicatorLayer | null>(null);
  const refreshLegendRef = useRef<() => void>(() => {});
  const [legendFeed] = useState(createLegendFeed);
  const instances = useIndicatorStore((s) => s.instances);
  const volumeVisible = useIndicatorStore((s) => s.volumeVisible);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const currentSource = source?.key === `${symbol}|${interval}` ? source : null;
  const delayed = currentSource?.delayed === true;
  // Delayed sources: the newest minute the source has, whatever the chart's timeframe (on 1h the
  // last bar's time says nothing about how fresh it is). null time = the source returned nothing.
  const [asOf, setAsOf] = useState<{
    symbol: string;
    time: number | null;
    checkedAt: number;
  } | null>(null);
  const shownAsOf = asOf?.symbol === symbol ? asOf : null;

  // Chart lifetime = component lifetime.
  useEffect(() => {
    const handles = createMainChart(containerRef.current!);
    handlesRef.current = handles;
    const layer = new IndicatorLayer(handles.chart);
    layer.setInstances(useIndicatorStore.getState().instances);
    layerRef.current = layer;

    // Drawings: rendered by a primitive on the candle series, edited by the controller.
    const getBars = () => liveRef.current?.bars ?? [];
    const drawings = new DrawingsPrimitive(
      getBars,
      () => INTERVAL_SECONDS[liveRef.current?.interval ?? '1m'],
    );
    handles.candles.attachPrimitive(drawings);
    const controller = new DrawingController(
      containerRef.current!,
      handles.chart,
      drawings,
      getBars,
    );

    // Legend follows the crosshair; off the chart it shows the last bar.
    let hoverTime: number | null = null;
    const refreshLegend = () => {
      const live = liveRef.current;
      legendFeed.set(
        buildLegend({
          symbol: live?.symbol ?? '',
          interval: live?.interval ?? '1m',
          bars: live?.bars ?? [],
          time: hoverTime,
          sources: withHiddenSources(
            useIndicatorStore.getState().instances,
            layer.legendSources(),
            INDICATORS,
            live?.interval ?? '1m',
          ),
        }),
      );
    };
    const onCrosshair = (p: MouseEventParams) => {
      hoverTime = p.time === undefined ? null : (p.time as number);
      refreshLegend();
    };
    handles.chart.subscribeCrosshairMove(onCrosshair);
    refreshLegendRef.current = refreshLegend;

    const syncAlertLines = () =>
      drawings.setAlertLines(
        alertLineIds(useAlertStore.getState().alerts, useDrawingStore.getState().symbol),
      );
    const unsubAlerts = [
      useAlertStore.subscribe((s, prev) => {
        if (s.alerts !== prev.alerts) syncAlertLines();
      }),
      useDrawingStore.subscribe((s, prev) => {
        if (s.symbol !== prev.symbol) syncAlertLines();
      }),
    ];
    syncAlertLines();
    setLastPriceSource(() => {
      const live = liveRef.current;
      const last = live?.bars.at(-1);
      return live && last ? { symbol: live.symbol, price: last.close } : null;
    });

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
        indicators: () => layer.debug(),
        indicatorSeries: (id, line) => layer.seriesData(id, line),
        xForTime: (time) => handles.chart.timeScale().timeToCoordinate(time as UTCTimestamp),
        paneCount: () => handles.chart.panes().length,
        drawings: () => {
          const s = useDrawingStore.getState();
          return {
            symbol: s.symbol,
            loading: s.loading,
            tool: s.tool,
            selectedId: s.selectedId,
            magnet: s.magnet,
            measuring: s.measuring,
            drawings: s.drawings,
            shapes: drawings.shapes(),
            ...drawings.debug(),
          };
        },
        measure: () => drawings.measure(),
        timeToX: (time) => drawings.timeToX(time),
        priceToY: (price) => handles.candles.priceToCoordinate(price),
        alerts: () => {
          const s = useAlertStore.getState();
          return { alerts: s.alerts, lastEventId: s.lastEventId };
        },
      };
    }

    return () => {
      if (import.meta.env.DEV) delete window.__catpivex;
      for (const u of unsubAlerts) u();
      setLastPriceSource(null);
      handlesRef.current = null;
      layerRef.current = null;
      refreshLegendRef.current = () => {};
      controller.dispose();
      handles.chart.unsubscribeCrosshairMove(onCrosshair);
      handles.chart.remove();
    };
  }, [legendFeed]);

  // Indicator instances: the layer reruns only what changed.
  useEffect(() => {
    layerRef.current?.setInstances(instances);
    refreshLegendRef.current();
  }, [instances]);

  useEffect(() => {
    if (handlesRef.current) setVolumeVisible(handlesRef.current, volumeVisible);
  }, [volumeVisible]);

  // Data + realtime for the current symbol/interval.
  useEffect(() => {
    const handles = handlesRef.current!;
    const layer = layerRef.current!;
    const refreshLegend = refreshLegendRef.current;
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

    // Candles + indicators on the full history; realtime goes through onRealtimeBar.
    const showBars = () => {
      setBars(handles, live.bars);
      layer.setSource(symbol, interval, live.bars);
      refreshLegend();
    };
    const onRealtimeBar = (bar: Candle) => {
      updateBar(handles, bar);
      layer.update(bar);
      refreshLegend();
    };

    showBars();
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
          showBars();
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
        showBars();
        timeScale.scrollToPosition(0, false); // jump (no animation) to the latest bar

        const url = klineStreamUrl(symbol, interval);
        if (url) {
          stopStream = connectKlineStream(url, {
            onKline: ({ candle }) => {
              if (applyRealtimeBar(live.bars, candle)) onRealtimeBar(candle);
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
            onBar: onRealtimeBar,
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

  useEffect(() => {
    if (!delayed) return;
    return startPolling(
      async (signal) => {
        const res = await fetchCandles({ symbol, interval: '1m', limit: 1 }, signal);
        if (signal.aborted) return;
        setAsOf({ symbol, time: res.candles.at(-1)?.time ?? null, checkedAt: Date.now() });
      },
      AS_OF_POLL_MS,
      { immediate: true },
    );
  }, [symbol, delayed]);

  const showWarning = currentSource?.warning && !currentSource.warningDismissed;

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} data-testid="chart" className="h-full w-full" />
      <div className="pointer-events-none absolute top-2 left-2 z-10 flex max-w-[60%] flex-col items-start gap-1 text-xs">
        {delayed && (
          <span
            data-testid="delayed-badge"
            title={
              shownAsOf
                ? asOfTitle(shownAsOf.time, shownAsOf.checkedAt)
                : 'Data from this source is delayed (about 15 min), not realtime'
            }
            className="pointer-events-auto rounded border border-[#f9a825]/60 bg-[#131722]/90 px-1.5 py-0.5 font-medium text-[#f9a825]"
          >
            Delayed
            {shownAsOf?.time != null && (
              <span
                data-testid="delayed-asof"
                data-time={shownAsOf.time}
                className="font-normal text-[#d1d4dc]"
              >
                {' · as of '}
                {formatAsOf(shownAsOf.time)}
              </span>
            )}
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
        <Legend feed={legendFeed} />
      </div>
    </div>
  );
}
