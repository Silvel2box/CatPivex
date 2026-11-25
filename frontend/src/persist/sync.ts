import { fetchDrawings, fetchLayout, saveDrawings, saveLayout } from '../api/persist';
import { sanitizeDrawings } from '../chart/drawings/geometry';
import type { Drawing } from '../chart/drawings/types';
import { useAlertStore } from '../store/alertStore';
import { useChartStore } from '../store/chartStore';
import { useDrawingStore } from '../store/drawingStore';
import { useIndicatorStore } from '../store/indicatorStore';
import { sanitizeLayout, type Layout } from './layout';
import { setDrawingFlusher } from './drawingFlush';
import { createDebouncedSaver } from './saver';

/** Saved layout -> stores. A missing or unreadable layout leaves the defaults. */
export async function restoreLayout(signal?: AbortSignal): Promise<void> {
  let layout: Layout;
  try {
    layout = sanitizeLayout((await fetchLayout(signal)).layout);
  } catch (err) {
    if (!signal?.aborted) console.error('Could not load the saved layout; using defaults', err);
    return;
  }
  useChartStore.setState({ symbol: layout.symbol, interval: layout.interval });
  useIndicatorStore.getState().restore(layout.indicators, layout.volumeVisible);
  useDrawingStore.setState({
    magnet: layout.magnet,
    stayInTool: layout.stayInTool,
    drawingBar: layout.drawingBar,
  });
}

function currentLayout(): Layout {
  const { symbol, interval } = useChartStore.getState();
  const { instances, volumeVisible } = useIndicatorStore.getState();
  const { magnet, stayInTool, drawingBar } = useDrawingStore.getState();
  return {
    version: 1,
    symbol,
    interval,
    indicators: instances,
    volumeVisible,
    magnet,
    stayInTool,
    drawingBar,
  };
}

/**
 * Wires the stores to the API: loads each symbol's drawings, saves drawings and the layout
 * 500 ms after the last change, and flushes pending saves when the page is hidden.
 * Returns a cleanup function.
 */
export function startPersistence(): () => void {
  const layoutSaver = createDebouncedSaver<Layout>(async (_key, layout) => {
    await saveLayout(layout);
  });
  const drawingSaver = createDebouncedSaver<Drawing[]>(async (symbol, drawings) => {
    await saveDrawings(symbol, drawings);
    useAlertStore.getState().reloadIfLinked(symbol);
  });
  setDrawingFlusher(() => drawingSaver.flush());

  let lastLayout = JSON.stringify(currentLayout());
  const onLayoutMaybeChanged = () => {
    const layout = currentLayout();
    const json = JSON.stringify(layout);
    if (json === lastLayout) return;
    lastLayout = json;
    layoutSaver.schedule('layout', layout);
  };

  let abort: AbortController | null = null;
  const loadDrawings = async (symbol: string) => {
    abort?.abort();
    const ctrl = new AbortController();
    abort = ctrl;
    useDrawingStore.getState().startLoading(symbol);
    // A pending save for a symbol we come back to must land before we read it again.
    await drawingSaver.flush();
    try {
      const res = await fetchDrawings(symbol, ctrl.signal);
      if (!ctrl.signal.aborted)
        useDrawingStore.getState().load(symbol, sanitizeDrawings(res.drawings));
    } catch (err) {
      // Stay in `loading` (drawing disabled): saving an empty list now would wipe the real one.
      if (!ctrl.signal.aborted) console.error(`Could not load drawings for ${symbol}`, err);
    }
  };

  const unsubs = [
    useChartStore.subscribe((s, prev) => {
      if (s.symbol !== prev.symbol) void loadDrawings(s.symbol);
      onLayoutMaybeChanged();
    }),
    useIndicatorStore.subscribe(onLayoutMaybeChanged),
    useDrawingStore.subscribe((s, prev) => {
      if (s.rev !== prev.rev && s.symbol && !s.loading) drawingSaver.schedule(s.symbol, s.drawings);
      if (
        s.magnet !== prev.magnet ||
        s.stayInTool !== prev.stayInTool ||
        s.drawingBar !== prev.drawingBar
      )
        onLayoutMaybeChanged();
    }),
  ];
  const onHide = () => {
    void layoutSaver.flush();
    void drawingSaver.flush();
  };
  window.addEventListener('pagehide', onHide);
  void loadDrawings(useChartStore.getState().symbol);

  return () => {
    for (const u of unsubs) u();
    window.removeEventListener('pagehide', onHide);
    abort?.abort();
    onHide();
    setDrawingFlusher(null);
  };
}
