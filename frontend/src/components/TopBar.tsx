import { INTERVALS } from '../api/types';
import { useChartStore } from '../store/chartStore';

export function TopBar() {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const setInterval = useChartStore((s) => s.setInterval);

  return (
    <header className="flex h-10 shrink-0 items-center gap-4 border-b border-[#2a2e39] bg-[#131722] px-3 text-sm text-[#d1d4dc]">
      <span className="font-semibold">{symbol}</span>
      <nav className="flex gap-1" aria-label="Timeframe">
        {INTERVALS.map((tf) => (
          <button
            key={tf}
            type="button"
            data-testid={`tf-${tf}`}
            aria-pressed={tf === interval}
            onClick={() => setInterval(tf)}
            className={`rounded px-2 py-1 ${
              tf === interval ? 'bg-[#2962ff] text-white' : 'hover:bg-[#2a2e39]'
            }`}
          >
            {tf}
          </button>
        ))}
      </nav>
    </header>
  );
}
