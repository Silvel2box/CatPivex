export interface Size {
  w: number;
  h: number;
}
export interface Pos {
  x: number;
  y: number;
}

export const BAR_TOP = 8;

const clamp = (v: number, max: number) => Math.round(Math.min(Math.max(v, 0), Math.max(max, 0)));

export function barPosition(saved: Pos | null, bar: Size, area: Size): Pos {
  const p = saved ?? { x: (area.w - bar.w) / 2, y: BAR_TOP };
  return { x: clamp(p.x, area.w - bar.w), y: clamp(p.y, area.h - bar.h) };
}
