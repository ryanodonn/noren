import { describe, it, expect } from "vitest";
import { planGenerationGaps, type GapCandidate } from "./plan-gaps";

const NOW = new Date("2026-10-02T14:00:00Z");

function gap(overrides: Partial<GapCandidate> = {}): GapCandidate {
  return {
    scenarioId: "scenario-1",
    variantId: "variant-1",
    level: "kodomo",
    depth: 0,
    lastFailureAt: null,
    lastAttemptAt: null,
    ...overrides,
  };
}

function plan(candidates: GapCandidate[], overrides: Partial<Parameters<typeof planGenerationGaps>[1]> = {}) {
  return planGenerationGaps(candidates, {
    targetDepth: 3,
    maxPicks: 4,
    priorityLevels: ["kodomo", "yoji"],
    now: NOW,
    ...overrides,
  });
}

describe("planGenerationGaps", () => {
  it("drops keys already at or above the target depth", () => {
    const picks = plan([
      gap({ variantId: "deep", depth: 3 }),
      gap({ variantId: "full", depth: 9 }),
      gap({ variantId: "thin", depth: 1 }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["thin"]);
  });

  it("returns nothing when every key is full", () => {
    expect(plan([gap({ depth: 5 })])).toEqual([]);
  });

  it("respects maxPicks", () => {
    const picks = plan(
      Array.from({ length: 10 }, (_, i) => gap({ variantId: `v${i}` })),
      { maxPicks: 4 },
    );
    expect(picks).toHaveLength(4);
  });

  it("spends every pick on levels a learner is actually on", () => {
    const picks = plan([
      gap({ variantId: "idle-1", level: "n4" }),
      gap({ variantId: "idle-2", level: "n5" }),
      gap({ variantId: "played", level: "yoji" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["played"]);
  });

  it("falls through to unplayed levels only when no played level has a gap", () => {
    const picks = plan([
      gap({ variantId: "idle-1", level: "n4", depth: 1 }),
      gap({ variantId: "idle-2", level: "n5", depth: 0 }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["idle-2", "idle-1"]);
  });

  it("treats no active learners as no priority filter", () => {
    const picks = plan([gap({ variantId: "a", level: "n4" })], { priorityLevels: [] });
    expect(picks.map((p) => p.variantId)).toEqual(["a"]);
  });

  it("fills the shallowest keys first", () => {
    const picks = plan([
      gap({ variantId: "two", depth: 2 }),
      gap({ variantId: "zero", depth: 0 }),
      gap({ variantId: "one", depth: 1 }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["zero", "one", "two"]);
  });

  it("deprioritizes a key that failed in the last day, without dropping it", () => {
    const picks = plan([
      gap({ variantId: "flaky", lastFailureAt: "2026-10-02T13:00:00Z" }),
      gap({ variantId: "clean" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["clean", "flaky"]);
  });

  it("stops deprioritizing once the failure is older than a day", () => {
    const picks = plan([
      gap({ variantId: "old-failure", lastFailureAt: "2026-09-30T13:00:00Z", lastAttemptAt: "2026-09-30T13:00:00Z" }),
      gap({ variantId: "clean", lastAttemptAt: "2026-10-01T13:00:00Z" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["old-failure", "clean"]);
  });

  it("prefers never-attempted keys, then least-recently attempted", () => {
    const picks = plan([
      gap({ variantId: "recent", lastAttemptAt: "2026-10-01T00:00:00Z" }),
      gap({ variantId: "never" }),
      gap({ variantId: "stale", lastAttemptAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["never", "stale", "recent"]);
  });

  it("never picks the same variant twice in one run", () => {
    const picks = plan([
      gap({ variantId: "v1", level: "kodomo" }),
      gap({ variantId: "v1", level: "yoji" }),
      gap({ variantId: "v2", level: "kodomo" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["v1", "v2"]);
  });

  it("ranks depth above a recent failure", () => {
    const picks = plan([
      gap({ variantId: "shallow-flaky", depth: 0, lastFailureAt: "2026-10-02T13:00:00Z" }),
      gap({ variantId: "deeper-clean", depth: 2 }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["shallow-flaky", "deeper-clean"]);
  });

  it("is deterministic for otherwise-identical candidates", () => {
    const candidates = [gap({ variantId: "b" }), gap({ variantId: "a" }), gap({ variantId: "c" })];
    expect(plan(candidates).map((p) => p.variantId)).toEqual(["a", "b", "c"]);
    expect(plan([...candidates].reverse()).map((p) => p.variantId)).toEqual(["a", "b", "c"]);
  });

  it("ignores an unparseable timestamp rather than throwing", () => {
    const picks = plan([
      gap({ variantId: "bad", lastAttemptAt: "not a date", lastFailureAt: "also not a date" }),
    ]);
    expect(picks.map((p) => p.variantId)).toEqual(["bad"]);
  });

  it("returns nothing when maxPicks is zero", () => {
    expect(plan([gap()], { maxPicks: 0 })).toEqual([]);
  });
});
