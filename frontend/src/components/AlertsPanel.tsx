import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ALERT_CONDITIONS, MAX_ALERT_NOTE, type Alert } from '../api/types';
import { chartLastPrice } from '../chart/lastPrice';
import { requestAlertPermission } from '../realtime/alertNotify';
import { useAlertStore, type AlertEditing } from '../store/alertStore';
import { useChartStore } from '../store/chartStore';
import {
  CONDITION_LABELS,
  deliveryStatus,
  draftFromAlert,
  draftToCreate,
  draftToUpdate,
  formatAlertPrice,
  formatEventTime,
  newDraft,
  noteLength,
  validateDraft,
  type AlertDraft,
  type DraftErrors,
} from './alertLogic';

const input =
  'w-full rounded border bg-[#131722] px-1.5 py-1 text-[#d1d4dc] outline-none focus:border-[#2962ff] disabled:text-[#787b86]';
const smallButton =
  'rounded px-1.5 py-0.5 text-[11px] text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]';

function AlertForm({
  editing,
  alert,
}: {
  editing: NonNullable<AlertEditing>;
  alert: Alert | null;
}) {
  const symbol = useChartStore((s) => s.symbol);
  const { create, update, setEditing } = useAlertStore.getState();
  const [draft, setDraft] = useState<AlertDraft>(() =>
    alert ? draftFromAlert(alert) : newDraft(symbol, chartLastPrice(symbol)),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const linked = alert?.drawing_id != null;
  const edit = <K extends keyof AlertDraft>(key: K, value: AlertDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    requestAlertPermission();
    const found = validateDraft(draft, linked);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    let ok: boolean;
    if (alert) {
      const patch = draftToUpdate(draft, alert);
      ok = Object.keys(patch).length === 0 || (await update(alert.id, patch));
    } else {
      ok = (await create(draftToCreate(draft))) !== null;
    }
    setBusy(false);
    if (ok) setEditing(null);
  };

  const fieldBorder = (key: keyof DraftErrors) =>
    errors[key] ? 'border-[#ef5350]' : 'border-[#2a2e39]';
  const error = (key: keyof DraftErrors) =>
    errors[key] && (
      <span data-testid={`alert-error-${key}`} className="text-[11px] text-[#ef5350]">
        {errors[key]}
      </span>
    );

  return (
    <form
      data-testid="alert-form"
      data-mode={editing.mode}
      noValidate
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 border-b border-[#2a2e39] p-3 text-xs"
    >
      <label className="flex flex-col gap-1 text-[#787b86]">
        Symbol
        <input
          data-testid="alert-symbol"
          value={draft.symbol}
          disabled={alert !== null}
          onChange={(e) => edit('symbol', e.target.value)}
          className={`${input} ${fieldBorder('symbol')}`}
        />
        {error('symbol')}
      </label>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-[#787b86]">
          Condition
          <select
            data-testid="alert-condition"
            value={draft.condition}
            onChange={(e) => edit('condition', e.target.value as AlertDraft['condition'])}
            className={`${input} border-[#2a2e39]`}
          >
            {ALERT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[#787b86]">
          Price
          <input
            type="number"
            step="any"
            data-testid="alert-price"
            value={draft.price}
            disabled={linked}
            aria-invalid={errors.price ? true : undefined}
            onChange={(e) => edit('price', e.target.value)}
            className={`${input} tabular-nums ${fieldBorder('price')}`}
          />
        </label>
      </div>
      {linked && (
        <span data-testid="alert-price-hint" className="text-[11px] text-[#787b86]">
          Linked to a line: move the line to change the price
        </span>
      )}
      {error('price')}
      <label className="flex items-center gap-2 text-[#d1d4dc]">
        <input
          type="checkbox"
          data-testid="alert-repeat"
          checked={draft.repeat}
          onChange={(e) => edit('repeat', e.target.checked)}
        />
        Repeat (off = once, then disabled)
      </label>
      <label className="flex flex-col gap-1 text-[#787b86]">
        <span className="flex justify-between">
          Note
          <span className={noteLength(draft.note) > MAX_ALERT_NOTE ? 'text-[#ef5350]' : undefined}>
            {noteLength(draft.note)}/{MAX_ALERT_NOTE}
          </span>
        </span>
        <input
          data-testid="alert-note"
          value={draft.note}
          onChange={(e) => edit('note', e.target.value)}
          className={`${input} ${fieldBorder('note')}`}
        />
        {error('note')}
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          data-testid="alert-cancel"
          onClick={() => setEditing(null)}
          className="rounded px-2 py-1 hover:bg-[#2a2e39]"
        >
          Cancel
        </button>
        <button
          type="submit"
          data-testid="alert-submit"
          disabled={busy}
          className="rounded bg-[#2962ff] px-3 py-1 text-white hover:bg-[#1e53e5] disabled:opacity-60"
        >
          {alert ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const { update, remove, setEditing } = useAlertStore.getState();
  return (
    <li
      data-testid="alert-row"
      data-alert-id={alert.id}
      data-symbol={alert.symbol}
      className="flex flex-col gap-0.5 border-b border-[#2a2e39] px-3 py-2 last:border-b-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`truncate ${alert.enabled ? '' : 'text-[#787b86]'}`}>
          <span data-testid="alert-row-symbol">{alert.symbol}</span>{' '}
          <span data-testid="alert-row-condition" className="text-[#787b86]">
            {CONDITION_LABELS[alert.condition]}
          </span>{' '}
          <span data-testid="alert-row-price" className="tabular-nums">
            {formatAlertPrice(alert.price)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <input
            type="checkbox"
            data-testid="alert-enabled"
            title={alert.enabled ? 'Enabled' : 'Disabled'}
            aria-label="Enabled"
            checked={alert.enabled}
            onChange={(e) => void update(alert.id, { enabled: e.target.checked })}
          />
          <button
            type="button"
            data-testid="alert-edit"
            onClick={() => setEditing({ mode: 'edit', id: alert.id })}
            className={smallButton}
          >
            Edit
          </button>
          <button
            type="button"
            data-testid="alert-delete"
            title="Delete alert"
            onClick={() => void remove(alert.id)}
            className={`${smallButton} hover:text-[#ef5350]`}
          >
            ×
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[11px] text-[#787b86]">
        <span data-testid="alert-row-repeat">{alert.repeat ? 'Repeat' : 'Once'}</span>
        {alert.drawing_id && (
          <span
            data-testid="alert-linked-badge"
            className="rounded border border-[#5b8cff]/50 px-1 text-[#5b8cff]"
          >
            linked to line
          </span>
        )}
        {alert.note && (
          <span data-testid="alert-row-note" className="truncate text-[#d1d4dc]">
            {alert.note}
          </span>
        )}
      </div>
    </li>
  );
}

function AlertsTab() {
  const alerts = useAlertStore((s) => s.alerts);
  const editing = useAlertStore((s) => s.editing);
  const loaded = useAlertStore((s) => s.loaded);
  const setEditing = useAlertStore((s) => s.setEditing);
  const editedAlert =
    editing?.mode === 'edit' ? (alerts.find((a) => a.id === editing.id) ?? null) : null;
  const showForm = editing?.mode === 'create' || editedAlert !== null;

  return (
    <>
      {showForm ? (
        <AlertForm
          key={editing?.mode === 'edit' ? `edit-${editing.id}` : 'create'}
          editing={editing!}
          alert={editedAlert}
        />
      ) : (
        <div className="border-b border-[#2a2e39] p-2">
          <button
            type="button"
            data-testid="alert-new"
            onClick={() => {
              requestAlertPermission();
              setEditing({ mode: 'create' });
            }}
            className="rounded border border-[#2a2e39] px-2 py-0.5 text-xs hover:bg-[#2a2e39]"
          >
            + New alert
          </button>
        </div>
      )}
      {alerts.length === 0 ? (
        <p data-testid="alerts-empty" className="px-3 py-2 text-xs text-[#787b86]">
          {loaded ? 'No alerts yet.' : 'Loading…'}
        </p>
      ) : (
        <ul>
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </>
  );
}

function HistoryTab() {
  const events = useAlertStore((s) => s.events);
  const historyLoaded = useAlertStore((s) => s.historyLoaded);
  const loadHistory = useAlertStore((s) => s.loadHistory);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <>
      <div className="flex justify-end border-b border-[#2a2e39] p-2">
        <button
          type="button"
          data-testid="alert-history-refresh"
          onClick={() => void loadHistory()}
          className={smallButton}
        >
          Refresh
        </button>
      </div>
      {events.length === 0 ? (
        <p data-testid="alert-history-empty" className="px-3 py-2 text-xs text-[#787b86]">
          {historyLoaded ? 'No alerts triggered yet.' : 'Loading…'}
        </p>
      ) : (
        <ul>
          {events.map((e) => (
            <li
              key={e.id}
              data-testid="alert-event-row"
              data-event-id={e.id}
              data-alert-id={e.alert_id}
              className="flex flex-col gap-0.5 border-b border-[#2a2e39] px-3 py-2 text-xs last:border-b-0"
            >
              <div className="flex justify-between gap-2">
                <span>
                  <span data-testid="alert-event-symbol">{e.symbol}</span>{' '}
                  <span className="text-[#787b86]">{CONDITION_LABELS[e.condition]}</span>{' '}
                  <span data-testid="alert-event-level" className="tabular-nums">
                    {formatAlertPrice(e.level)}
                  </span>
                </span>
                <span data-testid="alert-event-time" className="shrink-0 text-[#787b86]">
                  {formatEventTime(e.time)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                <span className="text-[#787b86]">
                  Price{' '}
                  <span data-testid="alert-event-price" className="text-[#d1d4dc] tabular-nums">
                    {formatAlertPrice(e.price)}
                  </span>
                </span>
                {deliveryStatus(e.deliveries).map((d) => (
                  <span
                    key={d.channel}
                    data-testid="alert-event-delivery"
                    data-channel={d.channel}
                    data-ok={d.ok}
                    title={d.detail}
                    className={`rounded border px-1 ${
                      d.ok
                        ? 'border-[#26a69a]/50 text-[#26a69a]'
                        : 'border-[#ef5350]/50 text-[#ef5350]'
                    }`}
                  >
                    {d.channel} {d.ok ? 'ok' : 'error'}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Alerts" button in the top bar + its dropdown panel (list / form / history). */
export function AlertsPanel() {
  const open = useAlertStore((s) => s.panelOpen);
  const tab = useAlertStore((s) => s.tab);
  const error = useAlertStore((s) => s.error);
  const count = useAlertStore((s) => s.alerts.filter((a) => a.enabled).length);
  const { openPanel, closePanel, setTab, clearError } = useAlertStore.getState();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) closePanel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closePanel]);

  const tabButton = (id: typeof tab, label: string) => (
    <button
      type="button"
      role="tab"
      data-testid={`alerts-tab-${id}`}
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex-1 px-3 py-1.5 ${
        tab === id ? 'border-b-2 border-[#2962ff] text-[#d1d4dc]' : 'text-[#787b86]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="alerts-button"
        aria-expanded={open}
        onClick={() => {
          if (open) return closePanel();
          requestAlertPermission();
          openPanel();
          void useAlertStore.getState().load();
        }}
        className={`rounded px-2 py-1 ${open ? 'bg-[#2a2e39]' : 'hover:bg-[#2a2e39]'}`}
      >
        Alerts{count > 0 && ` (${count})`}
      </button>
      {open && (
        <div
          data-testid="alerts-panel"
          className="absolute top-full left-0 z-30 mt-1 flex max-h-[75vh] w-96 flex-col overflow-y-auto rounded border border-[#2a2e39] bg-[#1e222d] text-sm text-[#d1d4dc] shadow-lg"
        >
          <div role="tablist" className="flex border-b border-[#2a2e39] text-xs">
            {tabButton('alerts', 'Alerts')}
            {tabButton('history', 'History')}
          </div>
          {error && (
            <div
              data-testid="alert-error"
              role="alert"
              className="flex items-start justify-between gap-2 border-b border-[#2a2e39] px-3 py-1.5 text-xs text-[#ef5350]"
            >
              <span>{error}</span>
              <button
                type="button"
                aria-label="Dismiss error"
                onClick={clearError}
                className="text-[#787b86] hover:text-[#d1d4dc]"
              >
                ×
              </button>
            </div>
          )}
          {tab === 'alerts' ? <AlertsTab /> : <HistoryTab />}
        </div>
      )}
    </div>
  );
}
