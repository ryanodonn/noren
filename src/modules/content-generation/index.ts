import "server-only";
import { ThinkingLevel } from "@google/genai";
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
import { classifyError } from "./classify-error";

export const POOL_MIN = db.POOL_MIN;

type ScenarioForContent = { id: string; name_en: string; speaker_a: string; speaker_b: string };
type VariantForContent = { id: string; description: string | null };
type LevelForContent = {
  id: LevelId;
  label_en: string;
  label_ja: string;
  spec: string | null;
  example_dialogues: Json;
};

/**
 * Neither task needs deep reasoning, and thinking is on by default for this
 * model family — left unset, gemini-3.6-flash defaults to a "medium" level
 * that was the dominant cost behind "grading feels slow," not network
 * latency (confirmed: generation_errors showed zero grading failures, so
 * the calls were succeeding, just slowly). Grading gets the lowest level
 * since it's the most latency-sensitive interactive path and has the
 * rule-based fallback as a safety net if MINIMAL is ever rejected;
 * generation gets LOW instead of MINIMAL since a rejected/malformed
 * response there has no fallback, just a retry.
 */
async function callGemini(prompt: string, thinkingLevel: ThinkingLevel): Promise<string> {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel },
    },
  });
  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

/**
 * `generation_errors` (2026-09) showed every logged generation failure so
 * far was Gemini 503 "high demand" — transient overload, gone on the very
 * next request. One retry recovers those without meaningfully touching the
 * free-tier daily quota (worst case, doubles the cost of an already-rare
 * failure). Anything else classify-error would call `quota_exceeded`,
 * `auth_error`, `parse_error`, etc. is not transient — retrying just burns
 * another request for the same result, so only `network_error` retries.
 */
async function callGeminiWithRetry(prompt: string, thinkingLevel: ThinkingLevel): Promise<string> {
  try {
    return await callGemini(prompt, thinkingLevel);
  } catch (err) {
    if (classifyError(err) !== "network_error") throw err;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return callGemini(prompt, thinkingLevel);
  }
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

/**
 * Who triggered this generation — kept distinct from the error *category*
 * because it answers a different question: not "what broke" but "did this
 * actually block a learner." `live` blocks a real session waiting on
 * `getDialogue`; `background_top_up` and `cron` are both maintenance work a
 * learner never sees fail. Logged as stage `pool_top_up` (background_top_up)
 * vs `generation` (live/cron) with `source` in `context` so a query can
 * still tell the daily pre-seed cron apart from a live pool-miss even
 * though both use stage `generation`.
 */
type GenerationSource = "live" | "background_top_up" | "cron";

async function generateAndStore(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
  opts?: { source?: GenerationSource },
) {
  const source = opts?.source ?? "live";
  const stage: "generation" | "pool_top_up" =
    source === "background_top_up" ? "pool_top_up" : "generation";
  const errorContext = {
    scenarioId: scenario.id,
    variantId: variant.id,
    level: level.id,
    stage,
    context: { source },
  };

  let parsed: { setting: string; lines: GeneratedLineJson[] };
  try {
    const raw = await callGeminiWithRetry(
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
      ThinkingLevel.LOW,
    );
    parsed = parseModelJson<{ setting: string; lines: GeneratedLineJson[] }>(raw);
    validateGeneratedDialogue(parsed);
  } catch (err) {
    await logGenerationError(supabase, { error: err, ...errorContext });
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
    await logGenerationError(supabase, { error: err, ...errorContext });
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
          return generateAndStore(supabase, scenario, variant, level, {
            source: "background_top_up",
          });
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
  return generateAndStore(supabase, scenario, variant, level, { source: "cron" });
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
      ThinkingLevel.MINIMAL,
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
