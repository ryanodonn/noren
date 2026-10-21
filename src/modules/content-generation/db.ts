import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";
import { PROMPT_VERSION } from "./prompts";

export type PoolKey = { scenarioId: string; variantId: string; level: LevelId };

// Was 2 — too shallow. The hand-authored seed pipeline writes exactly one
// dialogue per (scenario, variant) at kodomo, so a pool capped at 2 meant
// replaying a variant surfaced the same 1-2 dialogues almost every time.
export const POOL_MIN = 5;

/**
 * What the seed cron fills toward, as opposed to what counts as "thin".
 *
 * These used to be the same number because the background top-up shared the
 * threshold; that top-up is gone (Gemini is cron-only), and the coupling went
 * with it. Keeping the cron's target lower matters because it is now the only
 * thing filling the pool: there are 198 keys in the catalog, and reaching
 * depth 5 on all of them is ~873 dialogues — months at the free tier. Depth 3
 * is roughly half that, and the depth that actually prevents repeats.
 */
export const GAP_TARGET_DEPTH = 3;

export type PooledPick = { id: string; alreadyHeard: boolean };

/**
 * Count-then-offset, because PostgREST cannot `order by random()` — only
 * column names are allowed in `order`. Transfers one row regardless of pool
 * size, and both queries are a prefix scan on
 * generated_dialogues_pool_key_idx.
 */
async function pickRandomId(
  db: DbClient,
  key: PoolKey,
  excludeIds: readonly string[],
): Promise<string | null> {
  // PostgREST rejects an empty `in.()`, so the exclusion is only applied when
  // there is something to exclude.
  const exclusion = excludeIds.length > 0 ? `("${excludeIds.join('","')}")` : null;

  let countQuery = db
    .from("generated_dialogues")
    .select("id", { count: "exact", head: true })
    .eq("scenario_id", key.scenarioId)
    .eq("variant_id", key.variantId)
    .eq("level", key.level);
  if (exclusion) countQuery = countQuery.not("id", "in", exclusion);

  const { count, error: countError } = await countQuery;
  if (countError) throw countError;
  if (!count) return null;

  const offset = Math.floor(Math.random() * count);
  let pickQuery = db
    .from("generated_dialogues")
    .select("id")
    .eq("scenario_id", key.scenarioId)
    .eq("variant_id", key.variantId)
    .eq("level", key.level);
  if (exclusion) pickQuery = pickQuery.not("id", "in", exclusion);

  const { data, error } = await pickQuery.order("created_at").range(offset, offset);
  if (error) throw error;
  return data[0]?.id ?? null;
}

/**
 * Picks a pooled dialogue for this key, preferring one the caller hasn't
 * served before.
 *
 * Not filtered by prompt_version — hand-authored rows and every generation
 * era share one pool; prompt_version is provenance metadata, not a partition
 * key (docs/services.md §2.3).
 *
 * Falls back to a repeat rather than nothing, flagged so the drill can say
 * so: with no live generation left, refusing to serve a dialogue the learner
 * has already heard would turn an exhausted pool into a dead end. Returns
 * null only when the key has nothing pooled at all.
 */
export async function findPooledDialogue(
  db: DbClient,
  key: PoolKey,
  opts?: { excludeIds?: readonly string[] },
): Promise<PooledPick | null> {
  const excludeIds = opts?.excludeIds ?? [];

  if (excludeIds.length > 0) {
    const unheard = await pickRandomId(db, key, excludeIds);
    if (unheard) return { id: unheard, alreadyHeard: false };
  }

  const any = await pickRandomId(db, key, []);
  if (!any) return null;
  return { id: any, alreadyHeard: excludeIds.includes(any) };
}

export type PoolLine = {
  speaker: "a" | "b";
  ja: string;
  kana: string;
  romaji: string;
  en: string;
  gist: string | null;
  key_ja: string | null;
  key_romaji: string | null;
  key_en: string | null;
  tokens: { ja: string; kana?: string; romaji?: string; en?: string }[];
  acceptable_en?: string[];
};

/** Shared insert path for both hand-authored seeding and live Gemini generation. */
export async function insertDialogueWithLines(
  db: DbClient,
  params: {
    scenarioId: string;
    variantId: string;
    level: LevelId;
    setting: string | null;
    model: string;
    promptVersion?: string;
    lines: PoolLine[];
  },
) {
  const { data: dialogue, error: dialogueError } = await db
    .from("generated_dialogues")
    .insert({
      scenario_id: params.scenarioId,
      variant_id: params.variantId,
      level: params.level,
      model: params.model,
      setting: params.setting,
      prompt_version: params.promptVersion ?? PROMPT_VERSION,
    })
    .select("id")
    .single();
  if (dialogueError) throw dialogueError;

  const { error: linesError } = await db.from("generated_lines").insert(
    params.lines.map((line, seq) => ({
      dialogue_id: dialogue.id,
      seq,
      speaker: line.speaker,
      ja: line.ja,
      kana: line.kana,
      romaji: line.romaji,
      en: line.en,
      gist: line.gist,
      key_ja: line.key_ja,
      key_romaji: line.key_romaji,
      key_en: line.key_en,
      tokens: line.tokens,
      acceptable_en: line.acceptable_en ?? [],
    })),
  );
  if (linesError) throw linesError;

  return dialogue.id as string;
}

export async function fetchDialogueWithLines(db: DbClient, dialogueId: string) {
  const { data, error } = await db
    .from("generated_dialogues")
    .select("*, generated_lines(*)")
    .eq("id", dialogueId)
    .single();
  if (error) throw error;
  data.generated_lines.sort((a, b) => a.seq - b.seq);
  return data;
}

/** Keyed on all three pool-key columns, matching PoolKey. */
export function poolDepthKey(scenarioId: string, variantId: string, level: LevelId) {
  return `${scenarioId}::${variantId}::${level}`;
}

/**
 * Pool depth for every key that has anything pooled at all, in one query —
 * for scanning the whole catalog for gaps. Keys with zero rows don't appear;
 * callers must treat a missing key as depth 0.
 *
 * Reads the `pool_depths` view rather than tallying client-side. The previous
 * version selected every row of `generated_dialogues` and counted in JS,
 * which Supabase silently caps at 1000 rows — so it was set to start
 * under-reporting depth at exactly the point the pool finally filled, making
 * the cron re-fill already-full keys forever. The view aggregates in Postgres
 * and returns at most (active variants × levels) rows.
 */
export async function fetchAllDialogueCounts(db: DbClient) {
  const { data, error } = await db
    .from("pool_depths")
    .select("scenario_id, variant_id, level, depth");
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data) {
    if (!row.scenario_id || !row.variant_id || !row.level) continue;
    counts.set(poolDepthKey(row.scenario_id, row.variant_id, row.level), row.depth ?? 0);
  }
  return counts;
}

export async function fetchLine(db: DbClient, lineId: string) {
  const { data, error } = await db
    .from("generated_lines")
    .select("*")
    .eq("id", lineId)
    .single();
  if (error) throw error;
  return data;
}
