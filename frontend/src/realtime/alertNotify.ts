import type { AlertEvent } from '../api/types';
import { useAlertStore } from '../store/alertStore';

let audioCtx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (audioCtx || typeof AudioContext === 'undefined') return audioCtx;
  try {
    audioCtx = new AudioContext();
  } catch {
    return null;
  }
  return audioCtx;
}

const hasNotification = () => typeof Notification !== 'undefined';

/** Call from a user gesture: asks for notification permission once and unlocks audio. */
export function requestAlertPermission(): void {
  void audio()
    ?.resume()
    .catch(() => {});
  if (!hasNotification() || Notification.permission !== 'default') return;
  try {
    void Notification.requestPermission().catch(() => {});
  } catch {
    // Very old browsers: callback-only API, no permission prompt.
  }
}

export function playAlertSound(): void {
  const ctx = audio();
  if (!ctx) return;
  try {
    void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t0 + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.17);
    });
  } catch (err) {
    console.error('Alert sound failed', err);
  }
}

export function notifyAlertEvent(event: AlertEvent): void {
  playAlertSound();
  if (hasNotification() && Notification.permission === 'granted') {
    try {
      new Notification(event.symbol, { body: event.message, tag: `catpivex-alert-${event.id}` });
      return;
    } catch (err) {
      console.error('Browser notification failed', err);
    }
  }
  useAlertStore.getState().pushToast(event.symbol, event.message);
}
