import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";
import * as db from "./db";

export type ScenarioListItem = {
  id: string;
  slug: string;
  nameJa: string;
  nameEn: string;
  lineLabel: string | null;
  speakerA: string;
  speakerB: string;
  /** Completions across all levels/variants — "explored before", not a
   * per-level status (see catalog/db.ts fetchCompletionForUser). */
  timesCompleted: number;
};

export async function listLevels(supabase: DbClient) {
  return db.fetchLevels(supabase);
}

export async function getLevel(supabase: DbClient, levelId: LevelId) {
  return db.fetchLevelById(supabase, levelId);
}

/** All scenarios, annotated with how many times this user has completed
 * each (any level/variant — see ScenarioListItem). */
export async function listScenarios(
  supabase: DbClient,
  userId: string,
): Promise<ScenarioListItem[]> {
  const [scenarios, completions] = await Promise.all([
    db.fetchAllScenarios(supabase),
    db.fetchCompletionForUser(supabase, userId),
  ]);

  const completionCounts = new Map<string, number>();
  for (const c of completions) {
    completionCounts.set(c.scenario_id, (completionCounts.get(c.scenario_id) ?? 0) + 1);
  }

  return scenarios.map((s) => ({
    id: s.id,
    slug: s.slug,
    nameJa: s.name_ja,
    nameEn: s.name_en,
    lineLabel: s.line_label,
    speakerA: s.speaker_a,
    speakerB: s.speaker_b,
    timesCompleted: completionCounts.get(s.id) ?? 0,
  }));
}

export async function getScenario(supabase: DbClient, idOrSlug: string) {
  return db.fetchScenarioBySlugOrId(supabase, idOrSlug);
}

/**
 * An unplayed active variant for this user at this level, or null when the
 * scenario is exhausted at that level (services.md §3 — never hard-hidden,
 * the UI is expected to offer replay instead).
 */
export async function getNextVariant(
  supabase: DbClient,
  scenarioId: string,
  userId: string,
  level: LevelId,
) {
  const [variants, completedIds] = await Promise.all([
    db.fetchActiveVariants(supabase, scenarioId),
    db.fetchCompletedVariantIds(supabase, scenarioId, userId, level),
  ]);

  const completed = new Set(completedIds);
  const unplayed = variants.filter((v) => !completed.has(v.id));
  if (unplayed.length === 0) return null;

  return unplayed[Math.floor(Math.random() * unplayed.length)];
}

/**
 * Explicit replay: the scenario is exhausted at this level, so pick one of
 * the already-completed variants for the learner to redo. The resulting
 * session must be started with `isReplay: true` so it doesn't distort
 * progression stats (services.md §3).
 */
export async function resetScenario(
  supabase: DbClient,
  scenarioId: string,
  userId: string,
  level: LevelId,
) {
  const completedIds = await db.fetchCompletedVariantIds(
    supabase,
    scenarioId,
    userId,
    level,
  );
  if (completedIds.length === 0) return null;
  const variantId = completedIds[Math.floor(Math.random() * completedIds.length)];
  return db.fetchVariantById(supabase, variantId);
}

export async function getVariant(supabase: DbClient, variantId: string) {
  return db.fetchVariantById(supabase, variantId);
}

/** Every active variant across every scenario — for cross-scenario jobs
 * (e.g. the seed-generation cron), not the per-user picker flow. */
export async function listAllVariants(supabase: DbClient) {
  return db.fetchAllActiveVariants(supabase);
}

export async function markScenarioCompletion(
  supabase: DbClient,
  params: {
    userId: string;
    scenarioId: string;
    variantId: string;
    level: LevelId;
    score: number | null;
    isReplay: boolean;
  },
) {
  await db.upsertCompletion(supabase, params);
}
