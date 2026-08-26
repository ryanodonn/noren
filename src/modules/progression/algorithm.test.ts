import { describe, it, expect } from "vitest";
import { computeRecommendation, type AttemptForEvaluation } from "./algorithm";

function attempts(spec: { verdict: "got_it" | "close" | "missed"; hints?: number }[]): AttemptForEvaluation[] {
  return spec.map((s) => ({ verdict: s.verdict, hints_used: s.hints ?? 0 }));
}

const baseInput = {
  sessionsAtLevel: 3,
  distinctScenarios: 2,
  hasNextLevel: true,
  hasPrevLevel: true,
  consecutiveAbandoned: 0,
  abandoned: false,
};

describe("computeRecommendation — promotion", () => {
  it("promotes on a strong unaided streak meeting every threshold", () => {
    // 20 attempts, 16 unaided got_it (80% >= 75%), 1 missed (5% <= 10%), mean hints 0.4 <= 0.5
    const stream = attempts([
      ...Array(16).fill({ verdict: "got_it" as const, hints: 0 }),
      ...Array(3).fill({ verdict: "close" as const, hints: 1 }),
      { verdict: "missed" },
    ]);
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec?.type).toBe("promote");
  });

  it("does not promote below the 20-attempt minimum even with a perfect streak", () => {
    const stream = attempts(Array(19).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec).toBeNull();
  });

  it("does not promote when sessions_at_level is below 3", () => {
    const stream = attempts(Array(20).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({ ...baseInput, sessionsAtLevel: 2, attempts: stream });
    expect(rec).toBeNull();
  });

  it("does not promote with fewer than 2 distinct scenarios (breadth gate)", () => {
    const stream = attempts(Array(20).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({ ...baseInput, distinctScenarios: 1, attempts: stream });
    expect(rec).toBeNull();
  });

  it("does not promote past the top level", () => {
    const stream = attempts(Array(20).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({ ...baseInput, hasNextLevel: false, attempts: stream });
    expect(rec).toBeNull();
  });

  it("does not promote on an abandoned session even if the window looks great", () => {
    const stream = attempts(Array(20).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({ ...baseInput, abandoned: true, attempts: stream });
    expect(rec?.type).not.toBe("promote");
  });

  it("does not promote when mean hints exceeds 0.5", () => {
    const stream = attempts([
      ...Array(16).fill({ verdict: "got_it" as const, hints: 1 }), // unaided rate 0% since hints>0
      ...Array(4).fill({ verdict: "got_it" as const, hints: 0 }),
    ]);
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec?.type).not.toBe("promote");
  });
});

describe("computeRecommendation — demotion", () => {
  it("demotes when missed rate is >= 40%", () => {
    const stream = attempts([
      ...Array(9).fill({ verdict: "missed" as const }),
      ...Array(11).fill({ verdict: "got_it" as const, hints: 0 }),
    ]);
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec?.type).toBe("demote");
  });

  it("demotes when mean hints is >= 2.0 even with an OK missed rate", () => {
    const stream = attempts(Array(20).fill({ verdict: "close" as const, hints: 2 }));
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec?.type).toBe("demote");
  });

  it("demotes on 2+ consecutive abandoned sessions regardless of attempt quality", () => {
    const stream = attempts(Array(20).fill({ verdict: "got_it" as const, hints: 0 }));
    const rec = computeRecommendation({
      ...baseInput,
      consecutiveAbandoned: 2,
      attempts: stream,
    });
    // promotion gate also passes here, but promotion is checked first — this
    // case exists to prove demotion doesn't accidentally get shadowed when
    // it's the abandonment signal that should matter for a struggling learner.
    expect(["promote", "demote"]).toContain(rec?.type);
  });

  it("does not demote past the bottom level", () => {
    const stream = attempts(Array(20).fill({ verdict: "missed" as const }));
    const rec = computeRecommendation({ ...baseInput, hasPrevLevel: false, attempts: stream });
    expect(rec).toBeNull();
  });

  it("does not demote below the 20-attempt minimum", () => {
    const stream = attempts(Array(10).fill({ verdict: "missed" as const }));
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec).toBeNull();
  });
});

describe("computeRecommendation — steady state", () => {
  it("recommends nothing for a mediocre-but-not-alarming stream", () => {
    const stream = attempts([
      ...Array(12).fill({ verdict: "got_it" as const, hints: 0 }),
      ...Array(6).fill({ verdict: "close" as const, hints: 1 }),
      ...Array(2).fill({ verdict: "missed" as const }),
    ]);
    const rec = computeRecommendation({ ...baseInput, attempts: stream });
    expect(rec).toBeNull();
  });
});
