import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { fibLevelValue, fibLevelsOf } from '../chart/drawings/geometry';
import {
  FIB_CUSTOM_COLOR,
  FIB_EXTRA_LEVELS,
  FIB_LEVEL_MAX,
  FIB_LEVEL_MIN,
  FIB_LEVELS,
  FIB_MAX_LEVELS,
  type Drawing,
} from '../chart/drawings/types';
import { useDrawingStore } from '../store/drawingStore';
import { btn, svg } from './DrawingToolbar';

type Fib = Extract<Drawing, { type: 'fib' }>;

const PRESETS = [...FIB_LEVELS, ...FIB_EXTRA_LEVELS];
const PRESET_VALUES = new Set(PRESETS.map(({ level }) => level));
const PANEL_H = 280;

function Swatch({ color }: { color: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/30"
      style={{ background: color }}
    />
  );
}

export function FibLevelsPanel({ fib }: { fib: Fib }) {
  const [open, setOpen] = useState<'down' | 'up' | null>(null);
  const [draft, setDraft] = useState('');
  const [tried, setTried] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(null);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  const shown = fibLevelsOf(fib).map(({ level }) => level);
  const custom = shown.filter((level) => !PRESET_VALUES.has(level));
  const setLevels = (levels: number[]) => useDrawingStore.getState().setFibLevels(fib.id, levels);
  const value = draft.trim() === '' ? null : fibLevelValue(Number(draft));
  const full = value !== null && !shown.includes(value) && shown.length >= FIB_MAX_LEVELS;
  const invalid = (draft.trim() !== '' || tried) && (value === null || full);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (open) {
      setOpen(null);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    setOpen(r.bottom + PANEL_H > window.innerHeight && r.top > PANEL_H ? 'up' : 'down');
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (value === null || full) {
      setTried(true);
      return;
    }
    setLevels([...shown, value]);
    setDraft('');
    setTried(false);
  };

  return (
    <div ref={wrapRef}>
      <button
        type="button"
        data-testid="drawing-fib-levels"
        title="Levels"
        aria-label="Levels"
        aria-expanded={open !== null}
        onClick={toggle}
        className={btn(open !== null)}
      >
        {svg(<path d="M9 6h11M9 12h11M9 18h11M4 6h1.5M4 12h1.5M4 18h1.5" />)}
      </button>
      {open && (
        <div
          data-testid="fib-levels-panel"
          className={`absolute left-0 z-30 w-52 rounded border border-[#2a2e39] bg-[#1e222d] p-2 text-[11px] text-[#d1d4dc] shadow-lg ${
            open === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <div className="mb-1 text-[#787b86]">Levels</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            {PRESETS.map(({ level, color }) => {
              const on = shown.includes(level);
              const last = on && shown.length === 1;
              return (
                <label
                  key={level}
                  className={`flex items-center gap-1.5 ${last ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  title={last ? 'At least one level must stay' : undefined}
                >
                  <input
                    type="checkbox"
                    data-testid={`fib-level-${level}`}
                    checked={on}
                    disabled={last || (!on && shown.length >= FIB_MAX_LEVELS)}
                    onChange={() =>
                      setLevels(on ? shown.filter((l) => l !== level) : [...shown, level])
                    }
                    className="accent-[#2962ff]"
                  />
                  <Swatch color={color} />
                  <span className="tabular-nums">{level}</span>
                </label>
              );
            })}
          </div>
          {custom.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 border-t border-[#2a2e39] pt-2">
              {custom.map((level) => (
                <div key={level} className="flex items-center gap-1.5">
                  <Swatch color={FIB_CUSTOM_COLOR} />
                  <span className="flex-1 tabular-nums">{level}</span>
                  <button
                    type="button"
                    data-testid={`fib-level-remove-${level}`}
                    title={shown.length === 1 ? 'At least one level must stay' : 'Remove level'}
                    aria-label={`Remove level ${level}`}
                    disabled={shown.length === 1}
                    onClick={() => setLevels(shown.filter((l) => l !== level))}
                    className="flex h-5 w-5 items-center justify-center rounded text-[#b2b5be] hover:bg-[#2a2e39] hover:text-[#ef5350] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#b2b5be]"
                  >
                    {svg(<path d="M7 7l10 10M17 7 7 17" />)}
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            noValidate
            onSubmit={add}
            className="mt-2 flex items-center gap-1 border-t border-[#2a2e39] pt-2"
          >
            <input
              type="number"
              data-testid="fib-level-custom"
              aria-label="Custom level"
              placeholder="Custom level"
              step="any"
              min={FIB_LEVEL_MIN}
              max={FIB_LEVEL_MAX}
              value={draft}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setTried(false);
              }}
              className={`w-0 min-w-0 flex-1 rounded border bg-[#131722] px-1.5 py-0.5 text-[#d1d4dc] tabular-nums outline-none focus:border-[#2962ff] ${
                invalid ? 'border-[#ef5350] focus:border-[#ef5350]' : 'border-[#2a2e39]'
              }`}
            />
            <button
              type="submit"
              data-testid="fib-level-add"
              className="rounded bg-[#2962ff] px-2 py-0.5 text-white hover:bg-[#1e53e5]"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
