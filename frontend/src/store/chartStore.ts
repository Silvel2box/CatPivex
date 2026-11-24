import { create } from 'zustand';
import type { Interval } from '../api/types';

interface ChartState {
  symbol: string;
  interval: Interval;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
}

export const useChartStore = create<ChartState>()((set) => ({
  symbol: 'BINANCE:BTCUSDT',
  interval: '1m',
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
}));
