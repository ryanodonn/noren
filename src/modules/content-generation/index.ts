import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import type { LevelId, Verdict } from "@/lib/types";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { parseModelJson } from "@/lib/parse-model-json";
import * as db from "./db";
import { dialoguePrompt, gradePrompt } from "./prompts";
import { gradeAnswer } from "./grading";
import { validateGeneratedDialogue } from "./validation";
import { logGenerationError } from "./error-log";

type ScenarioForContent = { id: string; name_en: string; speaker_a: string; speaker_b: string };
type VariantForContent = { id: string; description: string | null };
type LevelForContent = {
  id: LevelId;
  label_en: string;
  label_ja: string;
  spec: string | null;
  example_dialogues: Json;
};

async function callGemini(prompt: string): Promise<string> {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

type GeneratedLineJson = {
  speaker: "a" | "b";
  ja: string;
  kana: string;
  romaji: string;
  en: string;
  gist: string;
  key_ja: string | null;
  key_romaji: string | null;
  key_en: string | null;
  tokens: { ja: string; kana?: string; romaji?: string; en?: string }[];
};

async function generateAndStore(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
  opts?: { background?: boolean },
) {
  const errorContext = {
    scenarioId: scenario.id,
    variantId: variant.id,
    level: level.id,
    context: { background: opts?.background ?? false },
  };

  let parsed: { setting: string; lines: GeneratedLineJson[] };
  try {
    const raw = await callGemini(
      dialoguePrompt(
        { nameEn: scenario.name_en, speakerA: scenario.speaker_a, speakerB: scenario.speaker_b },
        {
          labelEn: level.label_en,
          labelJa: level.label_ja,
          spec: level.spec ?? "",
          exampleDialogues: level.example_dialogues as
            | { speaker: "a" | "b"; ja: string; romaji: string; en: string }[][]
            | null,
        },
        variant.description ?? "a routine visit",
      ),
    );
    parsed = parseModelJson<{ setting: string; lines: GeneratedLineJson[] }>(raw);
    validateGeneratedDialogue(parsed);
  } catch (err) {
    await logGenerationError(supabase, { stage: "generation", error: err, ...errorContext });
    throw err;
  }

  try {
    return await db.insertDialogueWithLines(supabase, {
      scenarioId: scenario.id,
      variantId: variant.id,
      level: level.id,
      setting: parsed.setting,
      model: GEMINI_MODEL,
      lines: parsed.lines,
    });
  } catch (err) {
    await logGenerationError(supabase, { stage: "generation", error: err, ...errorContext });
    throw err;
  }
}

/**
 * Pool hit → serve, topping up in the background when the pool is thin.
 * Pool miss → generate live via Gemini, insert, serve. Old hand-authored
 * rows and new Gemini rows share the same pool (services.md §2.3).
 */
export async function getDialogue(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
) {
  const key = { scenarioId: scenario.id, variantId: variant.id, level: level.id };
  const pooled = await db.findPooledDialogue(supabase, key);

  if (pooled) {
    db.countPoolSize(supabase, key)
      .then((count) => {
        if (count < db.POOL_MIN) {
          return generateAndStore(supabase, scenario, variant, level, { background: true });
        }
      })
      .catch((err) => console.error("[content-generation] pool top-up failed", err));

    return db.fetchDialogueWithLines(supabase, pooled.id);
  }

  const dialogueId = await generateAndStore(supabase, scenario, variant, level);
  return db.fetchDialogueWithLines(supabase, dialogueId);
}

export async function getDialogueById(supabase: DbClient, dialogueId: string) {
  return db.fetchDialogueWithLines(supabase, dialogueId);
}

/** Pool depth per (variant, level) across the whole catalog, keyed
 * `${variantId}::${level}` — for scanning for gaps (seed-generation cron),
 * not the single-key lookups the drill path uses. A missing key means 0. */
export async function getPoolDepths(supabase: DbClient) {
  return db.fetchAllDialogueCounts(supabase);
}

/**
 * Public entry point for generating and pooling one dialogue outside the
 * normal drill request path — used by the seed-generation cron to fill
 * gaps ahead of any learner hitting them. Same validation, error logging,
 * and pool insert as a live pool-miss (generateAndStore, above).
 */
export async function generateDialogue(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
) {
  return generateAndStore(supabase, scenario, variant, level);
}

export async function getLine(supabase: DbClient, lineId: string) {
  return db.fetchLine(supabase, lineId);
}

export async function grade(
  supabase: DbClient,
  params: { lineId: string; userAnswer: string },
): Promise<{ verdict: Verdict; note: string | null }> {
  const line = await db.fetchLine(supabase, params.lineId);

  try {
    const raw = await callGemini(
      gradePrompt({ ja: line.ja, expectedEn: line.en, userAnswer: params.userAnswer }),
    );
    return parseModelJson<{ verdict: Verdict; note: string }>(raw);
  } catch (err) {
    await logGenerationError(supabase, {
      stage: "grading",
      error: err,
      context: { lineId: params.lineId, dialogueId: line.dialogue_id },
    });
    return gradeAnswer({
      userAnswer: params.userAnswer,
      expectedEn: line.en,
      acceptableEn: (line.acceptable_en as string[]) ?? [],
    });
  }
}
