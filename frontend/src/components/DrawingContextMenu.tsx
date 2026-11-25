import { useEffect, useRef } from 'react';
import { alertLevel } from '../chart/drawings/geometry';
import { addLineAlert, alertForLine, useAlertStore } from '../store/alertStore';
import { useDrawingStore } from '../store/drawingStore';

const item =
  'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-[#2a2e39]';

/** Right-click menu of a drawing (opened by the drawing controller). */
export function DrawingContextMenu() {
  const menu = useDrawingStore((s) => s.menu);
  const drawing = useDrawingStore((s) => s.drawings.find((d) => d.id === s.menu?.id) ?? null);
  const symbol = useDrawingStore((s) => s.symbol);
  const alerts = useAlertStore((s) => s.alerts);
  const { closeMenu, remove, reverse, setStyle } = useDrawingStore.getState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menu, closeMenu]);

  if (!menu || !drawing) return null;
  const run = (fn: () => void) => () => {
    fn();
    closeMenu();
  };
  const level = alertLevel(drawing);
  const lineAlert = level !== null && symbol ? alertForLine(alerts, symbol, drawing.id) : null;

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="drawing-menu"
      style={{ left: menu.x, top: menu.y }}
      className="fixed z-50 min-w-44 rounded border border-[#2a2e39] bg-[#1e222d] py-1 text-sm text-[#d1d4dc] shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {drawing.type === 'fib' && (
        <>
          <button
            type="button"
            role="menuitem"
            data-testid="menu-reverse"
            className={item}
            onClick={run(() => reverse(drawing.id))}
          >
            Reverse (swap 0 and 1)
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={drawing.extend === true}
            data-testid="menu-extend"
            className={item}
            onClick={run(() => setStyle(drawing.id, { extend: !drawing.extend }))}
          >
            Extend lines right
            <span className="text-[#5b8cff]">{drawing.extend ? '✓' : ''}</span>
          </button>
          <div className="my-1 h-px bg-[#2a2e39]" />
        </>
      )}
      {level !== null && symbol && (
        <>
          {lineAlert ? (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-edit-alert"
                className={item}
                onClick={run(() =>
                  useAlertStore.getState().openPanel('alerts', { mode: 'edit', id: lineAlert.id }),
                )}
              >
                Edit alert
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-remove-alert"
                className={item}
                onClick={run(() => void useAlertStore.getState().remove(lineAlert.id))}
              >
                Remove alert
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              data-testid="menu-add-alert"
              className={item}
              onClick={run(() => addLineAlert(symbol, drawing.id, level))}
            >
              Add alert
            </button>
          )}
          <div className="my-1 h-px bg-[#2a2e39]" />
        </>
      )}
      <button
        type="button"
        role="menuitem"
        data-testid="menu-delete"
        className={`${item} text-[#ef5350]`}
        onClick={run(() => remove(drawing.id))}
      >
        Delete
        <span className="text-[11px] text-[#787b86]">Del</span>
      </button>
    </div>
  );
}
