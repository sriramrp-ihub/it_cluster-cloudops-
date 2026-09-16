/**
 * Benchmark Timing Instrumentation (CO-026)
 *
 * Captures granular timestamp telemetry across the complete incident lifecycle:
 * - Investigation Duration
 * - Approval Duration
 * - Remediation Execution Duration
 * - Recovery Verification Duration
 * - Total MTTR
 *
 * NOTE: Per CO-026 acceptance criteria, actual "time-saved" calculations are
 * strictly deferred until CO-107 (Real Hermes Operational Turn) when real inference
 * latency is measurable, preventing fabricated synthetic benchmark numbers.
 */

export interface PhaseTimestamps {
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

export interface BenchmarkMetrics {
  incidentId: string;
  scenarioId: string;
  phases: {
    investigation: PhaseTimestamps;
    approval: PhaseTimestamps;
    remediation: PhaseTimestamps;
    verification: PhaseTimestamps;
  };
  totalDurationMs: number | null;
  isSyntheticMock: boolean;
  benchmarkDeferredToCO107?: boolean;
  humanBaselineMs?: number;
  timeSavedMs?: number | null;
  timeSavedPercent?: number | null;
}

export class BenchmarkTimingTracker {
  private phases: {
    investigation: { start?: number; end?: number };
    approval: { start?: number; end?: number };
    remediation: { start?: number; end?: number };
    verification: { start?: number; end?: number };
  } = {
    investigation: {},
    approval: {},
    remediation: {},
    verification: {}
  };

  constructor(
    private readonly incidentId: string,
    private readonly scenarioId: string = "ecs-image-pull-failure",
    private readonly isSyntheticMock: boolean = true
  ) {}

  startPhase(phase: "investigation" | "approval" | "remediation" | "verification"): void {
    this.phases[phase].start = Date.now();
  }

  endPhase(phase: "investigation" | "approval" | "remediation" | "verification"): void {
    this.phases[phase].end = Date.now();
  }

  getMetrics(): BenchmarkMetrics {
    const calcPhase = (p: { start?: number; end?: number }): PhaseTimestamps => {
      const durationMs = p.start && p.end ? Math.max(0, p.end - p.start) : null;
      return {
        startedAt: p.start ? new Date(p.start).toISOString() : null,
        endedAt: p.end ? new Date(p.end).toISOString() : null,
        durationMs
      };
    };

    const inv = calcPhase(this.phases.investigation);
    const app = calcPhase(this.phases.approval);
    const rem = calcPhase(this.phases.remediation);
    const ver = calcPhase(this.phases.verification);

    const totalDurationMs =
      (inv.durationMs ?? 0) +
      (app.durationMs ?? 0) +
      (rem.durationMs ?? 0) +
      (ver.durationMs ?? 0);

    const humanBaselineMs = 872000; // 14m 32s from docs/benchmarks/manual-engineer-baseline.md
    const timeSavedMs =
      !this.isSyntheticMock && totalDurationMs > 0
        ? Math.max(0, humanBaselineMs - totalDurationMs)
        : null;
    const timeSavedPercent =
      timeSavedMs !== null
        ? Math.round((timeSavedMs / humanBaselineMs) * 10000) / 100
        : null;

    return {
      incidentId: this.incidentId,
      scenarioId: this.scenarioId,
      phases: {
        investigation: inv,
        approval: app,
        remediation: rem,
        verification: ver
      },
      totalDurationMs: totalDurationMs > 0 ? totalDurationMs : null,
      isSyntheticMock: this.isSyntheticMock,
      benchmarkDeferredToCO107: this.isSyntheticMock,
      humanBaselineMs,
      timeSavedMs,
      timeSavedPercent
    };
  }
}
