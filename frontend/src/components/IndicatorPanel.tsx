import { useEffect, useRef, useState } from 'react';
import { instanceLabel } from '../chart/indicatorData';
import { INDICATORS, type IndicatorType, type ParamField, type Params } from '../chart/indicators';
import { useIndicatorPanelStore } from '../store/indicatorPanelStore';
import {
  DEFAULT_LINE_WIDTH,
  isValidParam,
  LINE_WIDTHS,
  useIndicatorStore,
  type IndicatorInstance,
} from '../store/indicatorStore';

const TYPES = Object.keys(INDICATORS) as IndicatorType[];

/** Number input that only commits valid values; an invalid draft is shown red and not applied. */
function ParamInput({
  field,
  value,
  onCommit,
}: {
  field: ParamField;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const parsed = text.trim() === '' ? NaN : Number(text);
  const valid = isValidParam(field, parsed);

  return (
    <label className="flex items-center gap-1 text-[11px] text-[#787b86]">
      {field.label}
      <input
        type="number"
        data-testid={`ind-param-${field.key}`}
        min={field.min}
        max={field.max}
        step={field.step}
        value={text}
        aria-invalid={!valid || undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const n = next.trim() === '' ? NaN : Number(next);
          if (isValidParam(field, n) && n !== value) onCommit(n);
        }}
        onBlur={() => setDraft(null)}
        className={`w-14 rounded border bg-[#131722] px-1 py-0.5 text-[#d1d4dc] tabular-nums outline-none focus:border-[#2962ff] ${
          valid ? 'border-[#2a2e39]' : 'border-[#ef5350]'
        }`}
      />
    </label>
  );
}

function InstanceRow({ inst, focused }: { inst: IndicatorInstance; focused: boolean }) {
  const { remove, updateParams, setColor, setWidth, toggleVisible } = useIndicatorStore.getState();
  const def = INDICATORS[inst.type];
  const commit = (patch: Params) => updateParams(inst.id, patch);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: 'nearest' });
    ref.current?.querySelector<HTMLElement>('[data-testid^="ind-param-"]')?.focus();
  }, [focused]);

  return (
    <li
      ref={ref}
      data-testid="ind-instance"
      data-type={inst.type}
      data-ind-id={inst.id}
      data-focused={focused || undefined}
      className={`flex flex-col gap-1 border-b border-[#2a2e39] px-3 py-2 last:border-b-0 ${
        focused ? 'bg-[#2a2e39]/50' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={inst.visible ? '' : 'text-[#787b86]'}>
          {instanceLabel(def, inst.params)}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            data-testid="ind-visible"
            aria-pressed={inst.visible}
            title={inst.visible ? 'Hide' : 'Show'}
            onClick={() => toggleVisible(inst.id)}
            className="rounded px-1.5 py-0.5 text-[11px] text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]"
          >
            {inst.visible ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            data-testid="ind-remove"
            aria-label={`Remove ${instanceLabel(def, inst.params)}`}
            onClick={() => remove(inst.id)}
            className="flex h-5 w-5 items-center justify-center rounded text-[#787b86] hover:bg-[#2a2e39] hover:text-[#ef5350]"
          >
            ×
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {def.params.map((f) => (
          <ParamInput
            key={f.key}
            field={f}
            value={inst.params[f.key]}
            onCommit={(v) => commit({ [f.key]: v })}
          />
        ))}
        {def.lines.map((l) => (
          <label
            key={l.key}
            className="flex items-center gap-1 text-[11px] text-[#787b86]"
            title={`${l.label} colour`}
          >
            {l.label}
            <input
              type="color"
              data-testid={`ind-color-${l.key}`}
              value={inst.colors[l.key] ?? l.color}
              onChange={(e) => setColor(inst.id, l.key, e.target.value)}
              className="h-5 w-6 cursor-pointer rounded border border-[#2a2e39] bg-transparent p-0"
            />
            {l.kind === 'line' && (
              <select
                data-testid={`ind-width-${l.key}`}
                aria-label={`${l.label} width`}
                title={`${l.label} width`}
                value={inst.widths[l.key] ?? DEFAULT_LINE_WIDTH}
                onChange={(e) => setWidth(inst.id, l.key, Number(e.target.value))}
                className="rounded border border-[#2a2e39] bg-[#131722] px-0.5 py-0.5 text-[11px] text-[#d1d4dc] outline-none focus:border-[#2962ff]"
              >
                {LINE_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w}px
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
      </div>
    </li>
  );
}

export function IndicatorPanel() {
  const instances = useIndicatorStore((s) => s.instances);
  const volumeVisible = useIndicatorStore((s) => s.volumeVisible);
  const { add, toggleVolume } = useIndicatorStore.getState();
  const open = useIndicatorPanelStore((s) => s.open);
  const focusId = useIndicatorPanelStore((s) => s.focusId);
  const { toggle, close } = useIndicatorPanelStore.getState();
  const rootRef = useRef<HTMLDivElement>(null);

  // Click outside / Escape closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="indicators-button"
        aria-expanded={open}
        onClick={toggle}
        className={`rounded px-2 py-1 ${open ? 'bg-[#2a2e39]' : 'hover:bg-[#2a2e39]'}`}
      >
        Indicators{instances.length > 0 && ` (${instances.length})`}
      </button>
      {open && (
        <div
          data-testid="indicator-panel"
          className="absolute top-full left-0 z-30 mt-1 flex max-h-[70vh] w-80 flex-col overflow-y-auto rounded border border-[#2a2e39] bg-[#1e222d] text-sm text-[#d1d4dc] shadow-lg"
        >
          <div className="flex flex-wrap gap-1 border-b border-[#2a2e39] p-2">
            {TYPES.map((type) => (
              <button
                key={type}
                type="button"
                data-testid={`ind-add-${type}`}
                title={`Add ${INDICATORS[type].label}`}
                onClick={() => add(type)}
                className="rounded border border-[#2a2e39] px-2 py-0.5 text-xs hover:bg-[#2a2e39]"
              >
                + {INDICATORS[type].label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 border-b border-[#2a2e39] px-3 py-2 text-xs">
            <input
              type="checkbox"
              data-testid="volume-toggle"
              checked={volumeVisible}
              onChange={toggleVolume}
            />
            Volume
          </label>
          {instances.length === 0 ? (
            <p className="px-3 py-2 text-xs text-[#787b86]">No indicators. Add one above.</p>
          ) : (
            <ul>
              {instances.map((inst) => (
                <InstanceRow key={inst.id} inst={inst} focused={inst.id === focusId} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
