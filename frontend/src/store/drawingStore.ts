import { create } from 'zustand';
import type { Drawing, DrawingType, DrawingWidth } from '../chart/drawings/types';

interface DrawingState {
  /** Symbol whose drawings are in `drawings`. */
  symbol: string | null;
  /** True until that symbol's drawings arrived from the API (drawing is disabled meanwhile). */
  loading: boolean;
  drawings: Drawing[];
  selectedId: string | null;
  /** Active drawing tool; null = cursor (select / drag). */
  tool: DrawingType | null;
  magnet: boolean;
  /** Bumped by user edits only (not by loading), so persistence saves exactly those. */
  rev: number;

  /** Symbol switch: clears drawings until `load` delivers them. */
  startLoading: (symbol: string) => void;
  /** Ignored if the symbol changed in the meantime. */
  load: (symbol: string, drawings: Drawing[]) => void;
  setTool: (tool: DrawingType | null) => void;
  select: (id: string | null) => void;
  /** Adds and selects. */
  add: (d: Drawing) => void;
  /** Replaces the drawing with the same id. */
  update: (d: Drawing) => void;
  remove: (id: string) => void;
  setStyle: (id: string, style: { color?: string; width?: DrawingWidth }) => void;
  setMagnet: (on: boolean) => void;
}

export const newDrawingId = () => `d-${Math.random().toString(36).slice(2, 10)}`;

export const useDrawingStore = create<DrawingState>()((set) => ({
  symbol: null,
  loading: true,
  drawings: [],
  selectedId: null,
  tool: null,
  magnet: true,
  rev: 0,

  startLoading: (symbol) =>
    set({ symbol, loading: true, drawings: [], selectedId: null, tool: null }),
  load: (symbol, drawings) =>
    set((s) => (s.symbol === symbol ? { loading: false, drawings, selectedId: null } : {})),
  setTool: (tool) => set({ tool, selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  add: (d) =>
    set((s) => ({ drawings: [...s.drawings, d], selectedId: d.id, tool: null, rev: s.rev + 1 })),
  update: (d) =>
    set((s) => ({ drawings: s.drawings.map((x) => (x.id === d.id ? d : x)), rev: s.rev + 1 })),
  remove: (id) =>
    set((s) => ({
      drawings: s.drawings.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      rev: s.rev + 1,
    })),
  setStyle: (id, style) =>
    set((s) => ({
      drawings: s.drawings.map((x) => (x.id === id ? { ...x, ...style } : x)),
      rev: s.rev + 1,
    })),
  setMagnet: (magnet) => set({ magnet }),
}));
