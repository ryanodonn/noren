import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";
import * as db from "./db";

export type ScenarioListItem = {
  id: string;
  slug: string;
  nameJa: string;
  nameEn: string;
  status: "unplayed" | "in_progress" | "complete";
  completedVariantCount: number;
  activeVariantCount: number;
};

export async function listLevels(supabase: DbClient) {
  return db.fetchLevels(supabase);
}

/** Scenarios for a level, annotated with this user's completion state. */
export async function listScenarios(
  supabase: DbClient,
  userId: string,
  level: LevelId,
): Promise<ScenarioListItem[]> {
  const [scenarios, completions] = await Promise.all([
    db.fetchScenariosWithVariants(supabase),
    db.fetchCompletionForUser(supabase, userId, level),
  ]);

  const completedVariantIds = new Set(completions.map((c) => c.variant_id));

  return scenarios.map((s) => {
    const activeVariants = s.scenario_variants.filter((v) => v.active);
    const completedCount = activeVariants.filter((v) =>
      completedVariantIds.has(v.id),
    ).length;

    const status: ScenarioListItem["status"] =
      completedCount === 0
        ? "unplayed"
        : completedCount === activeVariants.length
          ? "complete"
          : "in_progress";

    return {
      id: s.id,
      slug: s.slug,
      nameJa: s.name_ja,
      nameEn: s.name_en,
      status,
      completedVariantCount: completedCount,
      activeVariantCount: activeVariants.length,
    };
  });
}

export async function getBriefing(supabase: DbClient, idOrSlug: string) {
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
