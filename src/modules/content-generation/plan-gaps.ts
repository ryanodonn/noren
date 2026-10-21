// Which pool gaps the seed cron should spend its handful of daily Gemini
// calls on. Pure and DB-free so the policy is unit-testable; the cron route
// stays a thin orchestrator.
//
// Why this is the highest-leverage part of the generation pipeline: the pool
// has 198 keys (active variants x levels) and filling them all to depth 5
// needs ~873 dialogues — about four months at the free tier's sustainable
// rate. But 618 of those are for levels no learner has ever opened, and the
// only gaps that can actually dead-end somebody are the depth-0 keys at a
// level someone is playing. There were 19 of those. Chasing the catalog
// uniformly at random spent five of every six calls on content nobody could
// reach; ordering the work this way clears the blocking set in days.
import type { LevelId } from "@/lib/types";

export type GapCandidate = {
  scenarioId: string;
  variantId: string;
  level: LevelId;
  /** Dialogues currently pooled for this (scenario, variant, level). */
  depth: number;
  /** Most recent failed generation attempt for this key, if any. */
  lastFailureAt: string | null;
  /** Most recent attempt of any outcome, for round-robin fairness. */
  lastAttemptAt: string | null;
};

export type PlanGapsOptions = {
  /** Depth the cron fills toward. Distinct from POOL_MIN — see db.ts. */
  targetDepth: number;
  /** Hard cap, set by the free tier's per-minute request ceiling. */
  maxPicks: number;
  /** Levels at least one learner is currently on. */
  priorityLevels: readonly LevelId[];
  /** Injected so "failed recently" is testable. */
  now: Date;
};

const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Priority-ordered gaps to generate, at most one per variant.
 *
 * Ordering, in strict precedence:
 *  1. Levels someone is actually playing — and *only* those, unless no such
 *     gap exists. Falling through means a learner promoting into a new level
 *     redirects the cron there on its very next run, with no code change.
 *  2. Shallowest first. Depth 0 is a hard dead end now that there is no live
 *     generation fallback, so it has to outrank everything below.
 *  3. Keys that have not failed in the last day. A prompt that reliably
 *     fails for one key shouldn't eat a pick every single run.
 *  4. Least-recently attempted, never-attempted first — plain fairness.
 *  5. Variant id, purely so the result is deterministic for tests.
 */
export function planGenerationGaps(
  candidates: readonly GapCandidate[],
  opts: PlanGapsOptions,
): GapCandidate[] {
  const gaps = candidates.filter((c) => c.depth < opts.targetDepth);
  if (gaps.length === 0 || opts.maxPicks <= 0) return [];

  const priority = new Set(opts.priorityLevels);
  const inPriority = gaps.filter((c) => priority.has(c.level));
  const pool = inPriority.length > 0 ? inPriority : gaps;

  const failureCutoff = opts.now.getTime() - RECENT_FAILURE_WINDOW_MS;
  const failedRecently = (c: GapCandidate) => {
    const at = parseTime(c.lastFailureAt);
    return at !== null && at >= failureCutoff;
  };

  const ordered = [...pool].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;

    const aFailed = failedRecently(a) ? 1 : 0;
    const bFailed = failedRecently(b) ? 1 : 0;
    if (aFailed !== bFailed) return aFailed - bFailed;

    // Nulls first: a key nobody has ever tried is the fairest next pick.
    const aAt = parseTime(a.lastAttemptAt);
    const bAt = parseTime(b.lastAttemptAt);
    if (aAt === null && bAt !== null) return -1;
    if (aAt !== null && bAt === null) return 1;
    if (aAt !== null && bAt !== null && aAt !== bAt) return aAt - bAt;

    return a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0;
  });

  // One pick per variant per run, so a single under-filled variant can't
  // absorb the whole budget while every other scene stays empty.
  const picks: GapCandidate[] = [];
  const usedVariants = new Set<string>();
  for (const candidate of ordered) {
    if (usedVariants.has(candidate.variantId)) continue;
    usedVariants.add(candidate.variantId);
    picks.push(candidate);
    if (picks.length >= opts.maxPicks) break;
  }

  return picks;
}
