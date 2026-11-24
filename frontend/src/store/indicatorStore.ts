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
  toggleVisible: (id: string) => void;
  toggleVolume: () => void;
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

let nextId = 1;

export const useIndicatorStore = create<IndicatorState>()((set, get) => ({
  instances: [],
  volumeVisible: true,
  add: (type) => {
    const def = INDICATORS[type];
    const id = `ind-${nextId++}`;
    const colors = Object.fromEntries(def.lines.map((l) => [l.key, l.color]));
    set((s) => ({
      instances: [...s.instances, { id, type, params: { ...def.defaults }, colors, visible: true }],
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
  toggleVisible: (id) =>
    set((s) => ({
      instances: s.instances.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)),
    })),
  toggleVolume: () => set((s) => ({ volumeVisible: !s.volumeVisible })),
}));
