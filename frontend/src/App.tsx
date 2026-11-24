import { useEffect, useState } from 'react';
import { ChartView } from './chart/ChartView';
import { DrawingToolbar } from './components/DrawingToolbar';
import { TopBar } from './components/TopBar';
import { Watchlist } from './components/Watchlist';
import { restoreLayout, startPersistence } from './persist/sync';

export function App() {
  // The saved layout (symbol, timeframe, indicators) is applied before the chart mounts, so the
  // first candle request is already for the right symbol.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void restoreLayout(abort.signal).finally(() => {
      if (!abort.signal.aborted) setReady(true);
    });
    return () => abort.abort();
  }, []);
  useEffect(() => (ready ? startPersistence() : undefined), [ready]);

  return (
    <div className="flex h-screen flex-col bg-[#131722]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar />
        <main className="min-w-0 flex-1">{ready && <ChartView />}</main>
        <Watchlist />
      </div>
    </div>
  );
}
