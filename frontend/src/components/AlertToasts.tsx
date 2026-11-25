import { useEffect } from 'react';
import { useAlertStore, type AlertToast } from '../store/alertStore';

const TOAST_MS = 8_000;

function Toast({ toast }: { toast: AlertToast }) {
  const dismiss = useAlertStore((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <div
      data-testid="alert-toast"
      role="status"
      className="pointer-events-auto flex w-72 items-start gap-2 rounded border border-[#2a2e39] border-l-[#2962ff] border-l-4 bg-[#1e222d] px-3 py-2 text-sm text-[#d1d4dc] shadow-xl"
    >
      <div className="min-w-0 flex-1">
        <div data-testid="alert-toast-title" className="font-medium">
          {toast.title}
        </div>
        <div data-testid="alert-toast-body" className="text-xs break-words text-[#787b86]">
          {toast.body}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
        className="text-[#787b86] hover:text-[#d1d4dc]"
      >
        ×
      </button>
    </div>
  );
}

/** Alert messages when browser notifications are not allowed. */
export function AlertToasts() {
  const toasts = useAlertStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} />
      ))}
    </div>
  );
}
