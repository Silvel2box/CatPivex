import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { Candle } from '../api/types';
import { visibleBarRange, volumeProfile, type ProfileRow, type VolumeProfile } from './indicators';

export interface ProfileSpec {
  id: string;
  rows: number;
  valueArea: number;
  width: number;
  up: string;
  down: string;
  poc: string;
}

export interface ProfileDebug {
  id: string;
  rowCount: number;
  valueArea: number;
  bars: { from: number; to: number; firstTime: number; lastTime: number; volume: number } | null;
  rows: ProfileRow[];
  poc: number | null;
  vaLow: number | null;
  vaHigh: number | null;
  pocPrice: number | null;
}

interface Computed {
  bars: Candle[];
  key: string;
  range: { from: number; to: number } | null;
  profile: VolumeProfile | null;
}

interface Projected {
  spec: ProfileSpec;
  maxTotal: number;
  rows: { top: number; height: number; up: number; down: number; inVa: boolean }[];
  pocY: number | null;
}

const IN_VA_ALPHA = 0.7;
const OUT_VA_ALPHA = 0.3;
const POC_WIDTH = 2;

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private specs: ProfileSpec[] = [];
  private cache = new Map<string, Computed>();
  private projected: Projected[] = [];
  private version = 0;
  private notified = 0;
  private readonly views: IPrimitivePaneView[];
  private readonly getBars: () => Candle[];
  private readonly onChange: () => void;

  constructor(getBars: () => Candle[], onChange: () => void) {
    this.getBars = getBars;
    this.onChange = onChange;
    this.views = [{ renderer: () => this.renderer(), zOrder: () => 'bottom' }];
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setProfiles(specs: ProfileSpec[]): void {
    this.specs = specs;
    const ids = new Set(specs.map((s) => s.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    this.requestUpdate?.();
  }

  pocPrice(id: string): number | null {
    const p = this.cache.get(id)?.profile;
    if (!p) return null;
    const row = p.rows[p.poc];
    return (row.low + row.high) / 2;
  }

  debug(): ProfileDebug[] {
    this.refresh();
    return this.specs.map((s) => {
      const c = this.cache.get(s.id);
      const p = c?.profile ?? null;
      const r = c?.range ?? null;
      let volume = 0;
      if (c && r) for (let i = r.from; i <= r.to; i++) volume += c.bars[i].volume;
      return {
        id: s.id,
        rowCount: s.rows,
        valueArea: s.valueArea,
        bars:
          c && r
            ? {
                from: r.from,
                to: r.to,
                firstTime: c.bars[r.from].time,
                lastTime: c.bars[r.to].time,
                volume,
              }
            : null,
        rows: p?.rows.map((row) => ({ ...row })) ?? [],
        poc: p?.poc ?? null,
        vaLow: p?.vaLow ?? null,
        vaHigh: p?.vaHigh ?? null,
        pocPrice: this.pocPrice(s.id),
      };
    });
  }

  updateAllViews(): void {
    this.refresh();
    this.projected = this.project();
    if (this.version !== this.notified) {
      this.notified = this.version;
      this.onChange();
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views;
  }

  private refresh(): void {
    const bars = this.getBars();
    const range = visibleBarRange(
      this.chart?.timeScale().getVisibleLogicalRange() ?? null,
      bars.length,
    );
    const first = range ? bars[range.from] : undefined;
    const last = range ? bars[range.to] : undefined;
    const barKey =
      range && first && last
        ? [
            bars.length,
            range.from,
            range.to,
            first.time,
            last.time,
            last.open,
            last.high,
            last.low,
            last.close,
            last.volume,
          ].join('|')
        : '';
    let changed = false;
    for (const s of this.specs) {
      const key = `${barKey}|${s.rows}|${s.valueArea}`;
      const prev = this.cache.get(s.id);
      if (prev && prev.bars === bars && prev.key === key) continue;
      const profile = range
        ? volumeProfile(bars.slice(range.from, range.to + 1), s.rows, s.valueArea)
        : null;
      this.cache.set(s.id, { bars, key, range, profile });
      changed = true;
    }
    if (changed) this.version++;
  }

  private project(): Projected[] {
    const series = this.series;
    if (!series) return [];
    return this.specs.flatMap((spec) => {
      const p = this.cache.get(spec.id)?.profile;
      if (!p) return [];
      let maxTotal = 0;
      for (const r of p.rows) maxTotal = Math.max(maxTotal, r.up + r.down);
      if (maxTotal <= 0) return [];
      const rows: Projected['rows'] = [];
      p.rows.forEach((r, j) => {
        const yHigh = series.priceToCoordinate(r.high);
        const yLow = series.priceToCoordinate(r.low);
        if (yHigh === null || yLow === null) return;
        const top = Math.min(yHigh, yLow);
        const span = Math.abs(yLow - yHigh);
        rows.push({
          top,
          height: Math.max(1, span > 3 ? span - 1 : span),
          up: r.up,
          down: r.down,
          inVa: j >= p.vaLow && j <= p.vaHigh,
        });
      });
      const poc = p.rows[p.poc];
      const pocY = series.priceToCoordinate((poc.low + poc.high) / 2);
      return [{ spec, maxTotal, rows, pocY }];
    });
  }

  private renderer(): IPrimitivePaneRenderer {
    const items = this.projected;
    return {
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const right = mediaSize.width;
          for (const { spec, maxTotal, rows, pocY } of items) {
            const scale = (mediaSize.width * spec.width) / 100 / maxTotal;
            for (const r of rows) {
              const alpha = r.inVa ? IN_VA_ALPHA : OUT_VA_ALPHA;
              const upLen = r.up * scale;
              const downLen = r.down * scale;
              ctx.fillStyle = withAlpha(spec.up, alpha);
              ctx.fillRect(right - upLen, r.top, upLen, r.height);
              ctx.fillStyle = withAlpha(spec.down, alpha);
              ctx.fillRect(right - upLen - downLen, r.top, downLen, r.height);
            }
            if (pocY !== null) {
              ctx.fillStyle = spec.poc;
              ctx.fillRect(0, Math.round(pocY) - POC_WIDTH / 2, right, POC_WIDTH);
            }
          }
        });
      },
    };
  }
}
