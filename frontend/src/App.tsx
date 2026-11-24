import { ChartView } from './chart/ChartView';
import { TopBar } from './components/TopBar';

export function App() {
  return (
    <div className="flex h-screen flex-col bg-[#131722]">
      <TopBar />
      <main className="min-h-0 flex-1">
        <ChartView />
      </main>
    </div>
  );
}
