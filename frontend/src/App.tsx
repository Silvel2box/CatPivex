import { useEffect, useRef, useState } from 'react';
import { ChartView } from './chart/ChartView';
import { AlertToasts } from './components/AlertToasts';
import { DrawingBar } from './components/DrawingBar';
import { DrawingContextMenu } from './components/DrawingContextMenu';
import { DrawingToolbar } from './components/DrawingToolbar';
import { TopBar } from './components/TopBar';
import { Watchlist } from './components/Watchlist';
import { restoreLayout, startPersistence } from './persist/sync';
import { notifyAlertEvent } from './realtime/alertNotify';
import { startAlertPolling, useAlertStore } from './store/alertStore';

export function App() {
  // The saved layout (symbol, timeframe, indicators) is applied before the chart mounts, so the
  // first candle request is already for the right symbol.
  const [ready, setReady] = useState(false);
  const chartAreaRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void restoreLayout(abort.signal).finally(() => {
      if (!abort.signal.aborted) setReady(true);
    });
    return () => abort.abort();
  }, []);
  useEffect(() => (ready ? startPersistence() : undefined), [ready]);
  useEffect(() => {
    void useAlertStore.getState().load();
    return startAlertPolling(notifyAlertEvent);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-[#131722]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar />
        <main ref={chartAreaRef} className="relative min-w-0 flex-1">
          {ready && <ChartView />}
          <DrawingBar areaRef={chartAreaRef} />
        </main>
        <Watchlist />
      </div>
      <DrawingContextMenu />
      <AlertToasts />
    </div>
  );
}
