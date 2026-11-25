import { create } from 'zustand';
import type { Drawing, DrawingType, DrawingWidth } from '../chart/drawings/types';

/** Undo steps kept per symbol (Ctrl+Z). */
export const UNDO_LIMIT = 100;

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
  /** Ruler armed from the toolbar (one-shot; not a drawing). */
  measuring: boolean;
  stayInTool: boolean;
  drawingBar: { x: number; y: number } | null;
  /** Bumped by user edits only (not by loading), so persistence saves exactly those. */
  rev: number;
  /** Undo / redo snapshots of `drawings` for the current symbol (cleared on symbol switch). */
  past: Drawing[][];
  future: Drawing[][];
  /** Right-click menu on a drawing, at viewport coordinates. */
  menu: { id: string; x: number; y: number } | null;

  /** Symbol switch: clears drawings until `load` delivers them. */
  startLoading: (symbol: string) => void;
  /** Ignored if the symbol changed in the meantime. */
  load: (symbol: string, drawings: Drawing[]) => void;
  setTool: (tool: DrawingType | null) => void;
  select: (id: string | null) => void;
  /** Adds and selects, or with `stayInTool` keeps the tool and selects nothing (one undo step). */
  add: (d: Drawing) => void;
  /**
   * Replaces the drawing with the same id WITHOUT an undo step: a drag calls `checkpoint()` once
   * and then `update` on every mouse move, so the whole drag undoes in one step.
   */
  update: (d: Drawing) => void;
  /** Saves the current drawings as an undo step (and drops the redo steps). */
  checkpoint: () => void;
  remove: (id: string) => void;
  /** `fill` / `extend` apply to fib only. One undo step. */
  setStyle: (
    id: string,
    style: { color?: string; width?: DrawingWidth; fill?: number; extend?: boolean },
  ) => void;
  /** Fib: swap its anchors, so level 0 and 1 change ends. One undo step. */
  reverse: (id: string) => void;
  undo: () => void;
  redo: () => void;
  openMenu: (id: string, x: number, y: number) => void;
  closeMenu: () => void;
  setMagnet: (on: boolean) => void;
  /** Arming the ruler drops the active tool; `setTool` disarms it. */
  setMeasuring: (on: boolean) => void;
  setStayInTool: (on: boolean) => void;
  setDrawingBar: (pos: { x: number; y: number } | null) => void;
}

export const newDrawingId = () => `d-${Math.random().toString(36).slice(2, 10)}`;

/** The undo step to push before changing `drawings`. */
const step = (s: DrawingState) => ({
  past: [...s.past, s.drawings].slice(-UNDO_LIMIT),
  future: [],
});

/** After undo/redo the selection may point at a drawing that no longer exists. */
const keepSelection = (id: string | null, drawings: Drawing[]) =>
  id && drawings.some((d) => d.id === id) ? id : null;

export const useDrawingStore = create<DrawingState>()((set) => ({
  symbol: null,
  loading: true,
  drawings: [],
  selectedId: null,
  tool: null,
  magnet: false,
  measuring: false,
  stayInTool: false,
  drawingBar: null,
  rev: 0,
  past: [],
  future: [],
  menu: null,

  startLoading: (symbol) =>
    set({
      symbol,
      loading: true,
      drawings: [],
      selectedId: null,
      tool: null,
      measuring: false,
      past: [],
      future: [],
      menu: null,
    }),
  load: (symbol, drawings) =>
    set((s) =>
      s.symbol === symbol
        ? { loading: false, drawings, selectedId: null, past: [], future: [] }
        : {},
    ),
  setTool: (tool) => set({ tool, measuring: false, selectedId: null, menu: null }),
  select: (selectedId) => set({ selectedId }),
  add: (d) =>
    set((s) => ({
      ...step(s),
      drawings: [...s.drawings, d],
      selectedId: s.stayInTool ? null : d.id,
      tool: s.stayInTool ? s.tool : null,
      rev: s.rev + 1,
    })),
  update: (d) =>
    set((s) => ({ drawings: s.drawings.map((x) => (x.id === d.id ? d : x)), rev: s.rev + 1 })),
  checkpoint: () => set((s) => step(s)),
  remove: (id) =>
    set((s) => ({
      ...step(s),
      drawings: s.drawings.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      menu: null,
      rev: s.rev + 1,
    })),
  setStyle: (id, style) =>
    set((s) => ({
      ...step(s),
      drawings: s.drawings.map((x) => {
        if (x.id !== id) return x;
        const { fill, extend, ...rest } = style;
        if (x.type !== 'fib') return { ...x, ...rest };
        const next = { ...x, ...rest, ...(fill !== undefined && { fill }) };
        if (extend === true) next.extend = true;
        if (extend === false) delete next.extend; // stored as absent, like sanitizeDrawings
        return next;
      }),
      rev: s.rev + 1,
    })),
  reverse: (id) =>
    set((s) => ({
      ...step(s),
      drawings: s.drawings.map((x) =>
        x.id === id && x.type === 'fib' ? { ...x, a: x.b, b: x.a } : x,
      ),
      rev: s.rev + 1,
    })),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return {};
      return {
        drawings: prev,
        past: s.past.slice(0, -1),
        future: [s.drawings, ...s.future],
        selectedId: keepSelection(s.selectedId, prev),
        menu: null,
        rev: s.rev + 1,
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        drawings: next,
        past: [...s.past, s.drawings],
        future: s.future.slice(1),
        selectedId: keepSelection(s.selectedId, next),
        menu: null,
        rev: s.rev + 1,
      };
    }),
  openMenu: (id, x, y) => set({ menu: { id, x, y }, selectedId: id }),
  closeMenu: () => set({ menu: null }),
  setMagnet: (magnet) => set({ magnet }),
  setMeasuring: (measuring) =>
    set(measuring ? { measuring, tool: null, selectedId: null, menu: null } : { measuring }),
  setStayInTool: (stayInTool) => set({ stayInTool }),
  setDrawingBar: (drawingBar) => set({ drawingBar }),
}));
