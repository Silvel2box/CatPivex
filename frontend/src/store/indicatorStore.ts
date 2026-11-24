import { create } from 'zustand';
import {
  INDICATORS,
  type IndicatorDef,
  type IndicatorType,
  type Params,
} from '../chart/indicators';

export interface IndicatorInstance {
  id: string;
  type: IndicatorType;
  params: Params;
  /** Colour per line key. */
  colors: Record<string, string>;
  /** Width in px per line key ('line' kind only; histograms have none). */
  widths: Record<string, number>;
  visible: boolean;
}

interface IndicatorState {
  instances: IndicatorInstance[];
  volumeVisible: boolean;
  /** Adds an instance with the type's defaults; returns its id. */
  add: (type: IndicatorType) => string;
  remove: (id: string) => void;
  /** Merges `patch` into the params. Rejected (returns false, nothing changes) if any value is invalid. */
  updateParams: (id: string, patch: Params) => boolean;
  setColor: (id: string, line: string, color: string) => void;
  /** Rejected (returns false) unless `width` is one of LINE_WIDTHS and `line` is a line, not a histogram. */
  setWidth: (id: string, line: string, width: number) => boolean;
  toggleVisible: (id: string) => void;
  toggleVolume: () => void;
  /** Saved layout: replaces everything; new ids continue after the restored ones. */
  restore: (instances: IndicatorInstance[], volumeVisible: boolean) => void;
}

/** A value is valid when finite, within [min, max] and on the step grid from min. */
export function isValidParam(field: IndicatorDef['params'][number], value: number): boolean {
  if (!Number.isFinite(value) || value < field.min || value > field.max) return false;
  const steps = (value - field.min) / field.step;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

export function validParams(def: IndicatorDef, params: Params): boolean {
  return def.params.every((f) => f.key in params && isValidParam(f, params[f.key]));
}

/** Lightweight Charts accepts 1–4 px. */
export const LINE_WIDTHS = [1, 2, 3, 4] as const;
export const DEFAULT_LINE_WIDTH = 1;

let nextId = 1;

export const useIndicatorStore = create<IndicatorState>()((set, get) => ({
  instances: [],
  volumeVisible: true,
  add: (type) => {
    const def = INDICATORS[type];
    const id = `ind-${nextId++}`;
    const colors = Object.fromEntries(def.lines.map((l) => [l.key, l.color]));
    const widths = Object.fromEntries(
      def.lines.filter((l) => l.kind === 'line').map((l) => [l.key, DEFAULT_LINE_WIDTH]),
    );
    set((s) => ({
      instances: [
        ...s.instances,
        { id, type, params: { ...def.defaults }, colors, widths, visible: true },
      ],
    }));
    return id;
  },
  remove: (id) => set((s) => ({ instances: s.instances.filter((i) => i.id !== id) })),
  updateParams: (id, patch) => {
    const inst = get().instances.find((i) => i.id === id);
    if (!inst) return false;
    const def = INDICATORS[inst.type];
    if (Object.keys(patch).some((k) => !def.params.some((f) => f.key === k))) return false;
    const params = { ...inst.params, ...patch };
    if (!validParams(def, params)) return false;
    set((s) => ({ instances: s.instances.map((i) => (i.id === id ? { ...i, params } : i)) }));
    return true;
  },
  setColor: (id, line, color) =>
    set((s) => ({
      instances: s.instances.map((i) =>
        i.id === id ? { ...i, colors: { ...i.colors, [line]: color } } : i,
      ),
    })),
  setWidth: (id, line, width) => {
    const inst = get().instances.find((i) => i.id === id);
    const lineDef = inst && INDICATORS[inst.type].lines.find((l) => l.key === line);
    if (lineDef?.kind !== 'line' || !(LINE_WIDTHS as readonly number[]).includes(width))
      return false;
    set((s) => ({
      instances: s.instances.map((i) =>
        i.id === id ? { ...i, widths: { ...i.widths, [line]: width } } : i,
      ),
    }));
    return true;
  },
  toggleVisible: (id) =>
    set((s) => ({
      instances: s.instances.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    })),
  toggleVolume: () => set((s) => ({ volumeVisible: !s.volumeVisible })),
  restore: (instances, volumeVisible) => {
    for (const i of instances) {
      const n = Number(/^ind-(d+)$/.exec(i.id)?.[1]);
      if (n >= nextId) nextId = n + 1;
    }
    set({ instances, volumeVisible });
  },
}));
