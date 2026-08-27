import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import type { LevelId, Verdict } from "@/lib/types";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { parseModelJson } from "@/lib/parse-model-json";
import * as db from "./db";
import { dialoguePrompt, gradePrompt } from "./prompts";
import { gradeAnswer } from "./grading";

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
) {
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
  const parsed = parseModelJson<{ setting: string; lines: GeneratedLineJson[] }>(raw);

  return db.insertDialogueWithLines(supabase, {
    scenarioId: scenario.id,
    variantId: variant.id,
    level: level.id,
    setting: parsed.setting,
    model: GEMINI_MODEL,
    lines: parsed.lines,
  });
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
        if (count < db.POOL_MIN) return generateAndStore(supabase, scenario, variant, level);
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
    console.error("[content-generation] Gemini grading failed, falling back to word-overlap", err);
    return gradeAnswer({
      userAnswer: params.userAnswer,
      expectedEn: line.en,
      acceptableEn: (line.acceptable_en as string[]) ?? [],
    });
  }
}
