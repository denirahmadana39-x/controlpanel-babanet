export interface Counter {
  inc(value?: number, labels?: Record<string, string>): void;
}

export interface Gauge {
  set(value: number, labels?: Record<string, string>): void;
  inc(value?: number, labels?: Record<string, string>): void;
  dec(value?: number, labels?: Record<string, string>): void;
}

export interface Histogram {
  observe(value: number, labels?: Record<string, string>): void;
}

export interface HistogramStats {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: Record<string, number>;
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramStats>;
  recordedAt: string;
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramState {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
  bucketCounts: number[];
}

function labelsKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}="${value}"`);
  return `${name}{${parts.join(",")}}`;
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();

  counter(name: string): Counter {
    return {
      inc: (value = 1, labels) => {
        const key = labelsKey(name, labels);
        this.counters.set(key, (this.counters.get(key) ?? 0) + value);
      },
    };
  }

  gauge(name: string): Gauge {
    return {
      set: (value, labels) => {
        this.gauges.set(labelsKey(name, labels), value);
      },
      inc: (value = 1, labels) => {
        const key = labelsKey(name, labels);
        this.gauges.set(key, (this.gauges.get(key) ?? 0) + value);
      },
      dec: (value = 1, labels) => {
        const key = labelsKey(name, labels);
        this.gauges.set(key, (this.gauges.get(key) ?? 0) - value);
      },
    };
  }

  histogram(name: string, buckets: number[] = DEFAULT_BUCKETS): Histogram {
    const sorted = [...buckets].sort((a, b) => a - b);
    return {
      observe: (value, labels) => {
        const key = labelsKey(name, labels);
        const state = this.histograms.get(key) ?? {
          count: 0,
          sum: 0,
          min: Number.POSITIVE_INFINITY,
          max: 0,
          buckets: sorted,
          bucketCounts: new Array(sorted.length).fill(0),
        };
        state.count += 1;
        state.sum += value;
        if (value < state.min) state.min = value;
        if (value > state.max) state.max = value;
        for (let i = 0; i < sorted.length; i += 1) {
          const bucket = sorted[i];
          if (bucket !== undefined && value <= bucket)
            state.bucketCounts[i] = (state.bucketCounts[i] ?? 0) + 1;
        }
        this.histograms.set(key, state);
      },
    };
  }

  /**
   * Returns a stop function that records the elapsed seconds since start.
   */
  timer(name: string, labels?: Record<string, string>): () => void {
    const histogram = this.histogram(name);
    const start = process.hrtime.bigint();
    return () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      histogram.observe(seconds, labels);
    };
  }

  snapshot(): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) counters[key] = value;

    const gauges: Record<string, number> = {};
    for (const [key, value] of this.gauges) gauges[key] = value;

    const histograms: Record<string, HistogramStats> = {};
    for (const [key, state] of this.histograms) {
      const buckets: Record<string, number> = {};
      state.buckets.forEach((bucket, index) => {
        buckets[String(bucket)] = state.bucketCounts[index] ?? 0;
      });
      histograms[key] = {
        count: state.count,
        sum: state.sum,
        min: state.count === 0 ? 0 : state.min,
        max: state.max,
        buckets,
      };
    }

    return { counters, gauges, histograms, recordedAt: new Date().toISOString() };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

export const metrics = new MetricsRegistry();
