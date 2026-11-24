import type { IChartApi } from 'lightweight-charts';
import type { Candle } from '../../api/types';
import { newDrawingId, useDrawingStore } from '../../store/drawingStore';
import type { DrawingsPrimitive } from './DrawingsPrimitive';
import { hitTestAll, magnetSnap, moveDrawing } from './geometry';
import {
  ANCHOR_COUNT,
  DEFAULT_COLOR,
  FIB_WICK_SNAP_PX,
  HANDLE_TOLERANCE,
  HIT_TOLERANCE,
  type Anchor,
  type Drawing,
  type DrawingType,
  type HitPart,
  type Point,
} from './types';

/** Alt+<key> picks a tool (event.code, so keyboard layout doesn't matter). */
export const TOOL_KEYS: Record<string, DrawingType> = {
  KeyH: 'hline',
  KeyV: 'vline',
  KeyT: 'trendline',
  KeyR: 'rect',
  KeyF: 'fib',
};

/** A press-drag-release longer than this (px) finishes a 2-point drawing on release. */
const DRAG_FINISH_PX = 5;
/**
 * Weak magnet (like TradingView's): snap to the nearest bar's O/H/L/C only when the mouse is
 * within this many px of it; elsewhere the point follows the mouse exactly.
 */
export const MAGNET_RADIUS_PX = 10;
const GHOST_COLOR = '#2962ff';

export function makeDrawing(tool: DrawingType, a: Anchor, b: Anchor, id = newDrawingId()): Drawing {
  const base = { id, color: DEFAULT_COLOR[tool], width: 1 as const };
  if (tool === 'hline') return { ...base, type: 'hline', price: a.price };
  if (tool === 'vline') return { ...base, type: 'vline', time: a.time };
  return { ...base, type: tool, a, b };
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

/**
 * Mouse + keyboard for drawings on the candle pane. Listens on the chart container in the
 * capture phase: when it handles a press (drawing, or grabbing a drawing) it stops the event,
 * so the chart does not pan; otherwise the chart gets it as usual.
 */
export class DrawingController {
  private pending: { tool: DrawingType; a: Anchor; downAt: Point } | null = null;
  private preview: Drawing | null = null;
  private drag: { orig: Drawing; part: HitPart; start: Anchor } | null = null;
  private hoveredId: string | null = null;
  /** Where a click would place a point while a tool is active (null otherwise). */
  private ghost: Anchor | null = null;
  private readonly cleanup: (() => void)[] = [];
  private readonly container: HTMLElement;
  private readonly chart: IChartApi;
  private readonly primitive: DrawingsPrimitive;
  private readonly getBars: () => Candle[];

  constructor(
    container: HTMLElement,
    chart: IChartApi,
    primitive: DrawingsPrimitive,
    getBars: () => Candle[],
  ) {
    this.container = container;
    this.chart = chart;
    this.primitive = primitive;
    this.getBars = getBars;

    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      capture = false,
    ) => {
      target.addEventListener(type, fn as EventListener, capture);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, capture));
    };
    on(container, 'mousedown', (e) => this.onDown(e), true);
    on(window, 'mousemove', (e) => this.onMove(e));
    on(window, 'mouseup', (e) => this.onUp(e));
    on(window, 'keydown', (e) => this.onKey(e));

    let prevTool = useDrawingStore.getState().tool;
    this.cleanup.push(
      useDrawingStore.subscribe((s) => {
        if (s.tool !== prevTool) {
          prevTool = s.tool;
          this.pending = null;
          this.preview = null;
          this.ghost = null;
        }
        this.render();
      }),
    );
    this.render();
  }

  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
  }

  private render(): void {
    const s = useDrawingStore.getState();
    this.primitive.setState({
      drawings: s.drawings,
      selectedId: s.selectedId,
      preview: this.preview,
      hoveredId: this.hoveredId,
      // One readable accent for the aiming dot and its axis labels (fib's own colour is grey).
      ghost: this.ghost && s.tool ? { anchor: this.ghost, color: GHOST_COLOR } : null,
    });
  }

  /** Pane-relative point, or null outside the candle pane (price axis, sub-panes, time axis). */
  private local(e: MouseEvent): Point | null {
    const r = this.container.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const width = this.chart.timeScale().width();
    const height = this.chart.panes()[0]?.getHeight() ?? 0;
    return p.x >= 0 && p.y >= 0 && p.x < width && p.y < height ? p : null;
  }

  /**
   * Anchor under (x, y). With `snap`: a fib point (`wick`) first snaps to a high/low within
   * FIB_WICK_SNAP_PX, magnet or not; then the weak magnet (if on) to an O/H/L/C within
   * MAGNET_RADIUS_PX; otherwise the point is exactly where the mouse is.
   */
  private anchorAt(p: Point, snap: boolean, wick = false): Anchor | null {
    const raw = this.primitive.toAnchor(p.x, p.y);
    if (!raw || !snap) return raw;
    const within = (s: Anchor, radius: number) => {
      const x = this.primitive.timeToX(s.time);
      const y = this.primitive.priceToY(s.price);
      return x !== null && y !== null && Math.hypot(x - p.x, y - p.y) <= radius;
    };
    const bars = this.getBars();
    if (wick) {
      const w = magnetSnap(raw, bars, true, 'hl');
      if (within(w, FIB_WICK_SNAP_PX)) return w;
    }
    if (!useDrawingStore.getState().magnet) return raw;
    const s = magnetSnap(raw, bars, true);
    return within(s, MAGNET_RADIUS_PX) ? s : raw;
  }

  private onDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const p = this.local(e);
    if (!p) return;
    const store = useDrawingStore.getState();

    if (store.tool) {
      e.stopPropagation();
      e.preventDefault();
      if (store.loading) return;
      const a = this.anchorAt(p, true, (this.pending?.tool ?? store.tool) === 'fib');
      if (!a) return;
      this.ghost = null;
      if (this.pending) {
        this.finish(a);
      } else if (ANCHOR_COUNT[store.tool] === 1) {
        store.add(makeDrawing(store.tool, a, a));
      } else {
        this.pending = { tool: store.tool, a, downAt: p };
        this.preview = makeDrawing(store.tool, a, a, 'preview');
        this.render();
      }
      return;
    }

    const hit = hitTestAll(this.primitive.shapes(), p.x, p.y, HIT_TOLERANCE, HANDLE_TOLERANCE);
    if (!hit) {
      if (store.selectedId) store.select(null);
      return; // the chart pans as usual
    }
    e.stopPropagation();
    e.preventDefault();
    const orig = store.drawings.find((d) => d.id === hit.id);
    const start = this.anchorAt(p, false);
    store.select(hit.id);
    if (orig && start) this.drag = { orig, part: hit.part, start };
  }

  private onMove(e: MouseEvent): void {
    if (!this.pending && !this.drag) {
      this.updateHover(e);
      return;
    }
    const r = this.container.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top }; // may leave the pane mid-drag
    if (this.pending) {
      const b = this.anchorAt(p, true, this.pending.tool === 'fib');
      if (!b) return;
      this.preview = makeDrawing(this.pending.tool, this.pending.a, b, 'preview');
      this.render();
      return;
    }
    const drag = this.drag!;
    const cur = this.anchorAt(p, false);
    const to = this.anchorAt(p, true, drag.orig.type === 'fib' && drag.part !== 'body');
    if (!cur || !to) return;
    const delta = { dTime: cur.time - drag.start.time, dPrice: cur.price - drag.start.price };
    useDrawingStore.getState().update(moveDrawing(drag.orig, drag.part, delta, to));
  }

  /**
   * No button pressed. With a tool active: move the aiming dot (snapped exactly like a click
   * would be). Otherwise: highlight the drawing under the mouse. Re-render only on change.
   */
  private updateHover(e: MouseEvent): void {
    const tool = useDrawingStore.getState().tool;
    const p = this.local(e);
    if (tool) {
      const g = p ? this.anchorAt(p, true, tool === 'fib') : null;
      if (g?.time === this.ghost?.time && g?.price === this.ghost?.price) return;
      this.ghost = g;
      this.render();
      return;
    }
    const hit = p
      ? hitTestAll(this.primitive.shapes(), p.x, p.y, HIT_TOLERANCE, HANDLE_TOLERANCE)
      : null;
    const id = hit?.id ?? null;
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.render();
  }

  private onUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    this.drag = null;
    if (!this.pending) return;
    const r = this.container.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const { downAt } = this.pending;
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) <= DRAG_FINISH_PX) return; // click: wait for 2nd
    const b = this.anchorAt(p, true, this.pending.tool === 'fib');
    if (b) this.finish(b);
  }

  private finish(b: Anchor): void {
    const { tool, a } = this.pending!;
    this.pending = null;
    this.preview = null;
    useDrawingStore.getState().add(makeDrawing(tool, a, b));
  }

  private onKey(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    const store = useDrawingStore.getState();
    if (e.altKey && !e.ctrlKey && !e.metaKey && TOOL_KEYS[e.code]) {
      e.preventDefault();
      store.setTool(TOOL_KEYS[e.code]);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (this.pending || store.tool) store.setTool(null);
      else if (store.selectedId) store.select(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
      e.preventDefault();
      store.remove(store.selectedId);
    }
  }
}
