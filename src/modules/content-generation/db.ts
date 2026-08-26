import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";

// v2: translation-direction grading (acceptable_en) replaced the old
// production-direction grading (acceptable_ja/acceptable_romaji) — see
// docs/services.md §2.3. Bumped so the pool never mixes old/new-shaped rows.
export const CONTENT_VERSION = "authored-v2";

type PoolKey = { scenarioId: string; variantId: string; level: LevelId };

/** Picks randomly among the authored pool for this key, for replay variety. */
export async function findPooledDialogue(db: DbClient, key: PoolKey) {
  const { data, error } = await db
    .from("generated_dialogues")
    .select("id")
    .eq("scenario_id", key.scenarioId)
    .eq("variant_id", key.variantId)
    .eq("level", key.level)
    .eq("prompt_version", CONTENT_VERSION);
  if (error) throw error;
  if (data.length === 0) return null;
  return data[Math.floor(Math.random() * data.length)];
}

export type AuthoredLine = {
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

/** Seeding path — used to author new pool content (see scripts/seed-content). */
export async function insertDialogueWithLines(
  db: DbClient,
  params: {
    scenarioId: string;
    variantId: string;
    level: LevelId;
    setting: string | null;
    lines: AuthoredLine[];
  },
) {
  const { data: dialogue, error: dialogueError } = await db
    .from("generated_dialogues")
    .insert({
      scenario_id: params.scenarioId,
      variant_id: params.variantId,
      level: params.level,
      model: "authored",
      setting: params.setting,
      prompt_version: CONTENT_VERSION,
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

export async function fetchLine(db: DbClient, lineId: string) {
  const { data, error } = await db
    .from("generated_lines")
    .select("*")
    .eq("id", lineId)
    .single();
  if (error) throw error;
  return data;
}
