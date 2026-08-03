import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.js";

describe("MetricsRegistry", () => {
  it("counts and labels counters", () => {
    const registry = new MetricsRegistry();
    const total = registry.counter("http_requests");
    total.inc();
    total.inc(2, { route: "/api/x" });
    total.inc(1, { route: "/api/x" });
    const snapshot = registry.snapshot();
    expect(snapshot.counters["http_requests"]).toBe(1);
    expect(snapshot.counters['http_requests{route="/api/x"}']).toBe(3);
  });

  it("tracks gauges with set/inc/dec", () => {
    const registry = new MetricsRegistry();
    const gauge = registry.gauge("workers");
    gauge.set(2);
    gauge.inc();
    gauge.dec(2);
    expect(registry.snapshot().gauges["workers"]).toBe(1);
  });

  it("records histogram stats and buckets", () => {
    const registry = new MetricsRegistry();
    const latency = registry.histogram("latency_seconds", [0.1, 0.5, 1]);
    latency.observe(0.05);
    latency.observe(0.3);
    latency.observe(2);
    const entry = registry.snapshot().histograms["latency_seconds"];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("expected histogram entry");
    expect(entry.count).toBe(3);
    expect(entry.sum).toBeCloseTo(2.35, 5);
    expect(entry.min).toBeCloseTo(0.05, 5);
    expect(entry.max).toBe(2);
    expect(entry.buckets["0.1"]).toBe(1);
    expect(entry.buckets["0.5"]).toBe(2);
    expect(entry.buckets["1"]).toBe(2);
  });

  it("timer records elapsed seconds", () => {
    const registry = new MetricsRegistry();
    const stop = registry.timer("job_duration_seconds");
    stop();
    const entry = registry.snapshot().histograms["job_duration_seconds"];
    expect(entry).toBeDefined();
    if (!entry) throw new Error("expected histogram entry");
    expect(entry.count).toBe(1);
    expect(entry.sum).toBeGreaterThanOrEqual(0);
  });

  it("reset clears all series", () => {
    const registry = new MetricsRegistry();
    registry.counter("c").inc();
    registry.reset();
    expect(registry.snapshot().counters).toEqual({});
  });
});
