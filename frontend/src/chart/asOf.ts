// "Delayed · as of …": the newest minute the data source has, shown in Bangkok time like the chart.

const short = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const full = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Badge text for the newest 1m bar time (unix s), e.g. "24 Nov, 16:27". */
export function formatAsOf(time: number): string {
  return short.format(new Date(time * 1000));
}

/** Tooltip: full date of the data and when we last checked (ms). */
export function asOfTitle(time: number | null, checkedAtMs: number): string {
  const data = time === null ? 'no data yet' : `${full.format(new Date(time * 1000))} (Bangkok)`;
  return `Data from this source is delayed (about 15 min), not realtime.\nLatest data: ${data}\nChecked at ${clock.format(new Date(checkedAtMs))}`;
}
