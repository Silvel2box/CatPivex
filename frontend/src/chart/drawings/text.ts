export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const TEXT_BOX_PAD = 3;

export const textFont = (size: number) => `${size}px ${TEXT_FONT_FAMILY}`;

export function textLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function textBox(
  text: string,
  size: number,
  measure: (line: string) => number,
): { lines: string[]; w: number; h: number } {
  const lines = textLines(text);
  const w = Math.max(0, ...lines.map((l) => (l === '' ? 0 : measure(l))));
  return { lines, w, h: lines.length * size * TEXT_LINE_HEIGHT };
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

export function canvasMeasure(size: number): (line: string) => number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
  if (!ctx) return (line) => line.length * size * 0.6;
  const font = textFont(size);
  return (line) => {
    ctx.font = font;
    return ctx.measureText(line).width;
  };
}
