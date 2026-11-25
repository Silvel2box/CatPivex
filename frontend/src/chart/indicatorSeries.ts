import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Interval } from '../api/types';
import { DEFAULT_LINE_WIDTH, type IndicatorInstance } from '../store/indicatorStore';
import {
  GAP_COLOR,
  activeInstances,
  indexAt,
  toSeriesData,
  toSeriesPoint,
  withGaps,
  type LegendSource,
  type SeriesItem,
} from './indicatorData';
import {
  INDICATORS,
  dayKeyFor,
  runIndicator,
  type IndicatorDef,
  type IndicatorRun,
  type LineDef,
  type LinePoint,
} from './indicators';

const SUB_PANE_STRETCH = 0.3; // relative to the candle pane (1)
const LEVEL_COLOR = '#787b86';

type LineApi = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

interface Entry {
  inst: IndicatorInstance;
  def: IndicatorDef;
  series: Record<string, LineApi>;
  run: IndicatorRun | null;
}

export interface IndicatorDebug {
  id: string;
  type: string;
  params: Record<string, number>;
  lines: Record<string, { count: number; last: LinePoint | null; width?: number }>;
}

const asData = (points: SeriesItem[]) =>
  points as ({ time: UTCTimestamp; value: number; color?: string } | { time: UTCTimestamp })[];

/**
 * Owns the Lightweight Charts series (and sub-panes) of the indicator instances.
 * Main-pane indicators share pane 0 with the candles; each sub instance gets its own pane,
 * which the library removes once its last series is removed.
 */
export class IndicatorLayer {
  private entries = new Map<string, Entry>();
  private instances: IndicatorInstance[] = [];
  private symbol = '';
  private interval: Interval = '1m';
  private bars: Candle[] = [];
  private logged = new Set<string>();
  private chart: IChartApi;
  private run: typeof runIndicator;

  /** `run` is injectable for tests. */
  constructor(chart: IChartApi, run: typeof runIndicator = runIndicator) {
    this.chart = chart;
    this.run = run;
  }

  /** Store changed: add/remove series, rerun only instances that are new or got new params. */
  setInstances(instances: IndicatorInstance[]): void {
    this.instances = instances;
    this.reconcile();
  }

  /** New symbol / interval / history: rerun everything on `bars`. */
  setSource(symbol: string, interval: Interval, bars: Candle[]): void {
    this.symbol = symbol;
    this.interval = interval;
    this.bars = bars;
    const fresh = this.reconcile();
    for (const e of this.entries.values()) if (!fresh.has(e)) this.compute(e);
  }

  /** Realtime bar already merged into the candles: incremental update per instance. */
  update(bar: Candle): void {
    for (const e of this.entries.values()) {
      if (!e.run) continue;
      try {
        const res = e.run.update(bar);
        if (!res) continue;
        for (const line of e.def.lines) {
          const v = res.values?.[line.key];
          if (line.gaps) {
            this.updateGaps(e, line, res.time, v);
          } else if (v !== undefined) {
            const point = toSeriesPoint(
              line.kind,
              { time: res.time, value: v },
              this.color(e, line.key),
            );
            e.series[line.key].update(asData([point])[0]);
          }
        }
      } catch (err) {
        this.fail(e, err);
        e.run = null;
      }
    }
  }

  /** Rendered instances in store order, for the legend. */
  legendSources(): LegendSource[] {
    return this.ordered().map((e) => ({
      id: e.inst.id,
      def: e.def,
      params: e.inst.params,
      colors: e.inst.colors,
      lines: e.run?.lines ?? {},
    }));
  }

  debug(): IndicatorDebug[] {
    return this.ordered().map((e) => ({
      id: e.inst.id,
      type: e.inst.type,
      params: { ...e.inst.params },
      lines: Object.fromEntries(
        e.def.lines.map((l) => {
          const pts = e.run?.lines[l.key] ?? [];
          const opts = e.series[l.key].options() as { lineWidth?: number };
          return [
            l.key,
            { count: pts.length, last: pts[pts.length - 1] ?? null, width: opts.lineWidth },
          ];
        }),
      ),
    }));
  }

  /** `chart`: the series' data as the chart holds it (it drops whitespace); `items`: what is fed. */
  seriesData(id: string, key: string): { chart: SeriesItem[]; items: SeriesItem[] } {
    const e = this.entries.get(id);
    const line = e?.def.lines.find((l) => l.key === key);
    if (!e || !line) return { chart: [], items: [] };
    const plain = ({ time, value, color }: { time: unknown; value?: number; color?: string }) =>
      value === undefined
        ? { time: time as number }
        : { time: time as number, value, ...(color === undefined ? {} : { color }) };
    return { chart: e.series[key].data().map(plain), items: this.data(e, line).map(plain) };
  }

  private ordered(): Entry[] {
    return this.instances.flatMap((i) => this.entries.get(i.id) ?? []);
  }

  private color(e: Entry, line: string): string {
    return e.inst.colors[line] ?? e.def.lines.find((l) => l.key === line)!.color;
  }

  private width(e: Entry, line: string): LineWidth {
    return (e.inst.widths[line] ?? DEFAULT_LINE_WIDTH) as LineWidth;
  }

  /** Returns the entries it (re)computed. */
  private reconcile(): Set<Entry> {
    const active = activeInstances(this.instances, INDICATORS, this.interval);
    const keep = new Set(active.map((i) => i.id));
    for (const [id, e] of this.entries) {
      if (keep.has(id)) continue;
      for (const s of Object.values(e.series)) this.chart.removeSeries(s);
      this.entries.delete(id);
    }
    const computed = new Set<Entry>();
    for (const inst of active) {
      const e = this.entries.get(inst.id);
      if (!e) {
        const created = this.create(inst);
        this.entries.set(inst.id, created);
        this.compute(created);
        computed.add(created);
      } else if (JSON.stringify(e.inst.params) !== JSON.stringify(inst.params)) {
        e.inst = inst;
        this.compute(e);
        computed.add(e);
      } else if (e.inst.colors !== inst.colors || e.inst.widths !== inst.widths) {
        e.inst = inst;
        this.applyStyle(e);
      } else {
        e.inst = inst;
      }
    }
    return computed;
  }

  private create(inst: IndicatorInstance): Entry {
    const def = INDICATORS[inst.type];
    const main = def.pane === 'main';
    let pane = main ? 0 : this.chart.panes().length; // new pane at the bottom
    const series: Record<string, LineApi> = {};
    for (const line of def.lines) {
      const common = {
        priceScaleId: 'right',
        lastValueVisible: !main,
        priceLineVisible: false,
      };
      const color = inst.colors[line.key] ?? line.color;
      const s =
        line.kind === 'histogram'
          ? this.chart.addSeries(HistogramSeries, { ...common, color }, pane)
          : this.chart.addSeries(
              LineSeries,
              {
                ...common,
                color,
                lineWidth: (inst.widths[line.key] ?? DEFAULT_LINE_WIDTH) as LineWidth,
              },
              pane,
            );
      series[line.key] = s;
      pane = s.getPane().paneIndex();
    }
    if (!main) this.chart.panes()[pane]?.setStretchFactor(SUB_PANE_STRETCH);
    const first = series[def.lines[0].key];
    for (const price of def.levels ?? []) {
      first.createPriceLine({
        price,
        color: LEVEL_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
      });
    }
    return { inst, def, series, run: null };
  }

  private compute(e: Entry): void {
    try {
      e.run = this.run(e.def.calc, e.inst.params, dayKeyFor(this.symbol), this.bars);
    } catch (err) {
      e.run = null;
      this.fail(e, err);
    }
    this.setAll(e);
  }

  private setAll(e: Entry): void {
    for (const line of e.def.lines) e.series[line.key].setData(this.data(e, line));
  }

  /** Realtime counterpart of withGaps: whitespace or the value at `time`, and the break colour. */
  private updateGaps(e: Entry, line: LineDef, time: number, v: number | undefined): void {
    // The run keeps a started line's array, also when an update has just emptied it.
    const pts = e.run?.lines[line.key];
    if (!pts) return;
    const s = e.series[line.key];
    if (line.kind === 'line') {
      const last = pts[pts.length - 1];
      const prev = last?.time === time ? pts[pts.length - 2] : last;
      if (prev) {
        const i = indexAt(this.bars, time);
        const joined = v !== undefined && i > 0 && this.bars[i - 1].time === prev.time;
        s.update(asData([joined ? prev : { ...prev, color: GAP_COLOR }])[0], true);
      }
    }
    const color = this.color(e, line.key);
    const item = v === undefined ? { time } : toSeriesPoint(line.kind, { time, value: v }, color);
    s.update(asData([item])[0]);
  }

  private data(e: Entry, line: LineDef): ReturnType<typeof asData> {
    const points = toSeriesData(line.kind, e.run?.lines[line.key] ?? [], this.color(e, line.key));
    const times = line.gaps ? this.bars.map((b) => b.time) : null;
    return asData(times ? withGaps(line.kind, points, times) : points);
  }

  private applyStyle(e: Entry): void {
    for (const line of e.def.lines) {
      const color = this.color(e, line.key);
      if (line.kind === 'histogram') {
        // Bar colours live in the data.
        e.series[line.key].setData(this.data(e, line));
      } else {
        e.series[line.key].applyOptions({ color, lineWidth: this.width(e, line.key) });
      }
    }
  }

  private fail(e: Entry, err: unknown): void {
    if (this.logged.has(e.inst.id)) return;
    this.logged.add(e.inst.id);
    console.error(`Indicator ${e.inst.type} (${e.inst.id}) failed; skipped`, err);
  }
}
