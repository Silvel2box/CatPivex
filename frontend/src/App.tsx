import { ChartView } from './chart/ChartView';
import { TopBar } from './components/TopBar';
import { Watchlist } from './components/Watchlist';

export function App() {
  return (
    <div className="flex h-screen flex-col bg-[#131722]">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <ChartView />
        </main>
        <Watchlist />
      </div>
    </div>
  );
}
