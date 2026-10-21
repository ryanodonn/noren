// Everything that talks to Gemini.
//
// Deliberately split out of index.ts: the read path (getDialogue, grade) no
// longer calls the model at all, and keeping the SDK import out of index.ts
// is a structural guardrail against a live generation call creeping back
// onto a learner's request. Only the seed cron reaches this file.
import "server-only";
import { ThinkingLevel, Type, type Schema } from "@google/genai";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import type { LevelId } from "@/lib/types";
import { gemini, GEMINI_MODEL } from "@/lib/gemini";
import { parseModelJson } from "@/lib/parse-model-json";
import * as db from "./db";
import { dialoguePrompt } from "./prompts";
import { validateGeneratedDialogue } from "./validation";
import { repairGeneratedDialogue } from "./repair";
import { logGenerationAttempt, type AttemptTrace, type GenerationSource } from "./error-log";
import { classifyError, errorHttpStatus } from "./classify-error";

export type ScenarioForContent = {
  id: string;
  name_en: string;
  speaker_a: string;
  speaker_b: string;
};
export type VariantForContent = { id: string; description: string | null };
export type LevelForContent = {
  id: LevelId;
  label_en: string;
  label_ja: string;
  spec: string | null;
  example_dialogues: Json;
};

export type GeneratedLineJson = {
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
  acceptable_en?: string[];
};

/**
 * Server-side shape enforcement, which `responseMimeType: "application/json"`
 * alone does not give — that mode is reliable but best-effort, which is why
 * parseModelJson needs its fence-stripping fallback at all.
 *
 * This kills the whole "missing gist" / "speaker was not a or b" class of
 * failure before it costs us anything. It cannot express "lines alternate" or
 * "tokens reconstruct ja", so validation.ts and repair.ts still run.
 *
 * `minItems` is kept deliberately loose: an over-constrained schema can push
 * the model into returning nothing at all, and an empty response burns the
 * same per-minute request as a good one.
 */
const DIALOGUE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["setting", "lines"],
  properties: {
    setting: { type: Type.STRING },
    lines: {
      type: Type.ARRAY,
      minItems: "6",
      maxItems: "8",
      items: {
        type: Type.OBJECT,
        required: ["speaker", "ja", "kana", "romaji", "en", "gist", "tokens", "acceptable_en"],
        properties: {
          speaker: { type: Type.STRING, enum: ["a", "b"] },
          ja: { type: Type.STRING },
          kana: { type: Type.STRING },
          romaji: { type: Type.STRING },
          en: { type: Type.STRING },
          gist: { type: Type.STRING },
          key_ja: { type: Type.STRING, nullable: true },
          key_romaji: { type: Type.STRING, nullable: true },
          key_en: { type: Type.STRING, nullable: true },
          tokens: {
            type: Type.ARRAY,
            minItems: "1",
            items: {
              type: Type.OBJECT,
              required: ["ja"],
              properties: {
                ja: { type: Type.STRING },
                kana: { type: Type.STRING, nullable: true },
                romaji: { type: Type.STRING, nullable: true },
                en: { type: Type.STRING, nullable: true },
              },
            },
          },
          acceptable_en: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
  },
};

/**
 * Thinking is on by default for this model family: left unset,
 * gemini-3.6-flash picks a "medium" level. We pass LOW rather than MINIMAL
 * because a rejected or malformed response has no fallback — only a retry,
 * and a retry costs a request against a per-minute cap of 5.
 */
async function callGemini(prompt: string): Promise<string> {
  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: DIALOGUE_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

/**
 * Gate deciding whether a retry is affordable. The cron passes one that
 * accounts for both its wall-clock deadline and the per-minute request
 * budget; callers with neither can pass `() => true`.
 */
export type RetryAdmission = (estimatedCallMs: number) => boolean;

/** Rough p95 of an observed successful generation call. */
export const ESTIMATED_CALL_MS = 25_000;

const RETRY_DELAY_MS = 1_000;
const RETRY_JITTER_MS = 500;

/**
 * Retries exactly once, and only on a Gemini 503 ("experiencing high
 * demand") — genuinely transient, gone on the next request.
 *
 * Notably it does **not** retry a 429. The 429 body names which ceiling was
 * hit, and every one of the cron's logged 429s was the *per-minute* cap, with
 * the body asking for a 5-44s wait (19s on average). That does not fit inside
 * a 60s invocation, and spending a request against the daily cap to get a
 * near-certain second rejection is worse than not trying. Pacing the calls is
 * the fix for a 429; see the seed-generation route.
 *
 * Returns the traces of any failed-then-retried calls, which the old version
 * swallowed entirely — a run that failed once and then succeeded used to
 * leave no record at all.
 */
async function callGeminiWithRetry(
  prompt: string,
  admit: RetryAdmission,
): Promise<{ text: string; traces: AttemptTrace[] }> {
  const traces: AttemptTrace[] = [];
  const startedAt = Date.now();

  try {
    return { text: await callGemini(prompt), traces };
  } catch (err) {
    const category = classifyError(err);
    if (category !== "network_error") throw err;

    traces.push({
      category,
      httpStatus: errorHttpStatus(err),
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    });

    if (!admit(RETRY_DELAY_MS + RETRY_JITTER_MS + ESTIMATED_CALL_MS)) throw err;

    // Jittered so two concurrent retries don't re-collide on the same second.
    const delay = RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return { text: await callGemini(prompt), traces };
  }
}

function buildPrompt(
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
): string {
  return dialoguePrompt(
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
  );
}

type ParsedDialogue = { setting: string; lines: GeneratedLineJson[] };

/**
 * Generates one dialogue and adds it to the pool, recording the attempt
 * either way.
 *
 * Both the model call and the DB insert are logged, but separately, so a
 * Postgres failure classifies as `db_error` rather than being conflated with
 * a model failure.
 */
export async function generateAndStore(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelForContent,
  opts: { source: GenerationSource; admit?: RetryAdmission },
): Promise<string> {
  const startedAt = Date.now();
  const logContext = {
    stage: "generation" as const,
    source: opts.source,
    scenarioId: scenario.id,
    variantId: variant.id,
    level: level.id,
  };

  let parsed: ParsedDialogue;
  let traces: AttemptTrace[] = [];
  const details: Record<string, unknown> = {};

  try {
    const result = await callGeminiWithRetry(
      buildPrompt(scenario, variant, level),
      opts.admit ?? (() => true),
    );
    traces = result.traces;

    const raw = parseModelJson<ParsedDialogue>(result.text);
    const repaired = repairGeneratedDialogue(raw);
    parsed = repaired.value;
    if (repaired.notes.length > 0) details.repairs = repaired.notes;
    details.acceptable_en_counts = parsed.lines?.map((l) => l.acceptable_en?.length ?? 0) ?? [];

    validateGeneratedDialogue(parsed);
  } catch (err) {
    await logGenerationAttempt(supabase, {
      ...logContext,
      error: err,
      durationMs: Date.now() - startedAt,
      attemptCount: traces.length + 1,
      traces,
      details,
    });
    throw err;
  }

  try {
    const dialogueId = await db.insertDialogueWithLines(supabase, {
      scenarioId: scenario.id,
      variantId: variant.id,
      level: level.id,
      setting: parsed.setting,
      model: GEMINI_MODEL,
      lines: parsed.lines,
    });
    await logGenerationAttempt(supabase, {
      ...logContext,
      durationMs: Date.now() - startedAt,
      attemptCount: traces.length + 1,
      traces,
      details: { ...details, dialogueId },
    });
    return dialogueId;
  } catch (err) {
    await logGenerationAttempt(supabase, {
      ...logContext,
      error: err,
      durationMs: Date.now() - startedAt,
      attemptCount: traces.length + 1,
      traces,
      details,
    });
    throw err;
  }
}
