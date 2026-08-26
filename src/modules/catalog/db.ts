import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";

export async function fetchLevels(db: DbClient) {
  const { data, error } = await db
    .from("levels")
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return data;
}

export async function fetchScenariosWithVariants(db: DbClient) {
  const { data, error } = await db
    .from("scenarios")
    .select("*, scenario_variants(id, active)");
  if (error) throw error;
  return data;
}

export async function fetchCompletionForUser(
  db: DbClient,
  userId: string,
  level: LevelId,
) {
  const { data, error } = await db
    .from("scenario_completion")
    .select("scenario_id, variant_id")
    .eq("user_id", userId)
    .eq("level", level);
  if (error) throw error;
  return data;
}

export async function fetchScenarioBySlugOrId(db: DbClient, idOrSlug: string) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { data, error } = await db
    .from("scenarios")
    .select("*, seed_phrases(*)")
    .eq(isUuid ? "id" : "slug", idOrSlug)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchVariantById(db: DbClient, variantId: string) {
  const { data, error } = await db
    .from("scenario_variants")
    .select("*")
    .eq("id", variantId)
    .single();
  if (error) throw error;
  return data;
}

export async function fetchActiveVariants(db: DbClient, scenarioId: string) {
  const { data, error } = await db
    .from("scenario_variants")
    .select("*")
    .eq("scenario_id", scenarioId)
    .eq("active", true);
  if (error) throw error;
  return data;
}

export async function fetchCompletedVariantIds(
  db: DbClient,
  scenarioId: string,
  userId: string,
  level: LevelId,
) {
  const { data, error } = await db
    .from("scenario_completion")
    .select("variant_id")
    .eq("scenario_id", scenarioId)
    .eq("user_id", userId)
    .eq("level", level);
  if (error) throw error;
  return data.map((row) => row.variant_id);
}

export async function upsertCompletion(
  db: DbClient,
  params: {
    userId: string;
    scenarioId: string;
    variantId: string;
    level: LevelId;
    score: number | null;
    isReplay: boolean;
  },
) {
  const { error } = await db.from("scenario_completion").upsert(
    {
      user_id: params.userId,
      scenario_id: params.scenarioId,
      variant_id: params.variantId,
      level: params.level,
      score: params.score,
      is_replay: params.isReplay,
      completed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,variant_id,level" },
  );
  if (error) throw error;
}
