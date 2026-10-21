import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Verdict } from "@/lib/types";
import * as db from "./db";
import { gradeAnswer } from "./grading";
import { generateAndStore } from "./generate";
import type {
  ScenarioForContent,
  VariantForContent,
  LevelForContent,
  RetryAdmission,
} from "./generate";

export const POOL_MIN = db.POOL_MIN;
export const GAP_TARGET_DEPTH = db.GAP_TARGET_DEPTH;
export { poolDepthKey } from "./db";
export type { GenerationSource } from "./error-log";
export { planGenerationGaps, type GapCandidate, type PlanGapsOptions } from "./plan-gaps";
export { ESTIMATED_CALL_MS } from "./generate";
export type { RetryAdmission } from "./generate";
export { getGeneratorHealth } from "./health";
export type { GeneratorHealth, HealthSignal } from "./health";
export type { QuotaLimitKind } from "./classify-error";

/**
 * No dialogue is pooled for this (scenario, variant, level).
 *
 * This is a real dead end until the seed cron fills the key, and that is a
 * deliberate trade-off rather than an oversight: Gemini is cron-only now, so
 * there is nothing to generate from on a learner's request. Callers should
 * turn this into a specific "nothing pooled for this scene yet" message —
 * not a generic failure — so the learner knows to pick another scene rather
 * than retrying into the same wall.
 */
export class PoolEmptyError extends Error {
  constructor(readonly key: { scenarioId: string; variantId: string; level: string }) {
    super(`No pooled dialogue for ${key.scenarioId}/${key.variantId}/${key.level}`);
    this.name = "PoolEmptyError";
  }
}

/**
 * Serves a pooled dialogue, preferring one this learner hasn't heard.
 *
 * Pool-only: no Gemini call, no background top-up. Both were removed once the
 * data showed no learner had *ever* triggered a live generation (zero
 * `source='live'` rows in the whole log) while the interactive paths were
 * quietly consuming the free tier's entire daily request budget — all of the
 * cost, none of the benefit. See services.md §2.3.
 *
 * `excludeDialogueIds` comes from the caller because dialogue history lives
 * in Session's tables, which this module must not query. Throws
 * `PoolEmptyError` when the key has nothing pooled.
 */
export async function getDialogue(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
  opts?: { excludeDialogueIds?: readonly string[] },
) {
  const key = { scenarioId: scenario.id, variantId: variant.id, level: level.id };
  const pooled = await db.findPooledDialogue(supabase, key, {
    excludeIds: opts?.excludeDialogueIds,
  });
  if (!pooled) throw new PoolEmptyError(key);

  return {
    dialogue: await db.fetchDialogueWithLines(supabase, pooled.id),
    alreadyHeard: pooled.alreadyHeard,
  };
}

export async function getDialogueById(supabase: DbClient, dialogueId: string) {
  return db.fetchDialogueWithLines(supabase, dialogueId);
}

/**
 * Pool depth for every key with anything pooled, keyed by `poolDepthKey`.
 * For scanning the catalog for gaps (the seed cron), not the single-key
 * lookups the drill path uses. A missing key means depth 0.
 */
export async function getPoolDepths(supabase: DbClient) {
  return db.fetchAllDialogueCounts(supabase);
}

/**
 * Generates one dialogue and pools it. The seed cron is the only caller —
 * this is the sole path in the app that spends a Gemini request.
 *
 * `admit` lets the caller refuse a retry it can't afford; see the cron's
 * wall-clock and request budgets.
 */
export async function generateDialogue(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
  opts?: { admit?: RetryAdmission },
) {
  return generateAndStore(supabase, scenario, variant, level, {
    source: "cron",
    admit: opts?.admit,
  });
}

export async function getLine(supabase: DbClient, lineId: string) {
  return db.fetchLine(supabase, lineId);
}

/**
 * Rule-based only — no LLM, no network, no fallback branch because there is
 * nothing left to fall back *from* (services.md §2.3).
 *
 * Gemini used to grade here with `gradeAnswer` as a safety net. It was
 * removed because the free tier cannot support an interactive path: grading
 * alone hit the per-day request cap 31 times, competing with the seed cron
 * for the same tiny budget. Grading now costs one indexed row read (~50ms
 * instead of 1-2s) and cannot fail past that read.
 *
 * The honest trade-off: paraphrase tolerance is now whatever the line's own
 * `en`, its `acceptable_en`, and phrasings.ts cover between them. See
 * grading.ts on the `got_it` threshold.
 */
export async function grade(
  supabase: DbClient,
  params: { lineId: string; userAnswer: string },
): Promise<{ verdict: Verdict; note: string | null; score: number }> {
  const line = await db.fetchLine(supabase, params.lineId);
  return gradeAnswer({
    userAnswer: params.userAnswer,
    expectedEn: line.en,
    acceptableEn: (line.acceptable_en as string[]) ?? [],
  });
}
