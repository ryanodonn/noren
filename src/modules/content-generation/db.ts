import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";
import { PROMPT_VERSION } from "./prompts";

type PoolKey = { scenarioId: string; variantId: string; level: LevelId };

export const POOL_MIN = 2;

/**
 * Picks randomly among the pool for this key, for replay variety. Not
 * filtered by prompt_version — old hand-authored rows and new
 * Gemini-generated rows share one pool; prompt_version is provenance
 * metadata, not a partition key (see docs/services.md §2.3).
 */
export async function findPooledDialogue(db: DbClient, key: PoolKey) {
  const { data, error } = await db
    .from("generated_dialogues")
    .select("id")
    .eq("scenario_id", key.scenarioId)
    .eq("variant_id", key.variantId)
    .eq("level", key.level);
  if (error) throw error;
  if (data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

export async function countPoolSize(db: DbClient, key: PoolKey) {
  const { count, error } = await db
    .from("generated_dialogues")
    .select("id", { count: "exact", head: true })
    .eq("scenario_id", key.scenarioId)
    .eq("variant_id", key.variantId)
    .eq("level", key.level);
  if (error) throw error;
  return count ?? 0;
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

/**
 * Pool depth for every (variant, level) that has anything pooled at all,
 * in one query — for scanning the whole catalog for gaps (the
 * seed-generation cron) instead of one countPoolSize call per combo.
 * Combos with zero rows simply don't appear; callers should treat a
 * missing key as depth 0.
 */
export async function fetchAllDialogueCounts(db: DbClient) {
  const { data, error } = await db.from("generated_dialogues").select("variant_id, level");
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const row of data) {
    const key = `${row.variant_id}::${row.level}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
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
