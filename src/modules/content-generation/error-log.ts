import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import {
  classifyError,
  errorDetails,
  errorHttpStatus,
  type ErrorCategory,
  type ErrorStage,
} from "./classify-error";

export type { ErrorCategory, ErrorStage };

/**
 * Who asked for this generation. `live` and `background_top_up` are
 * **historical only** — Gemini is cron-only now, so neither path exists
 * (services.md §2.3). They're kept because rows written under them still
 * exist and the DB CHECK still accepts them. `backfill` is the one-off local
 * script that fills `acceptable_en` on legacy dialogues.
 */
export type GenerationSource = "live" | "background_top_up" | "cron" | "backfill";

/** One failed HTTP call inside a generation run, including retried ones. */
export type AttemptTrace = {
  category: ErrorCategory;
  httpStatus: number | null;
  message: string;
  durationMs: number;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

type LogParams = {
  stage: ErrorStage;
  source: GenerationSource;
  scenarioId?: string | null;
  variantId?: string | null;
  level?: string | null;
  durationMs?: number | null;
  /** 1 for a first-try outcome; >1 means the retry wrapper fired. */
  attemptCount?: number;
  /** Intermediate failures that were retried past — otherwise invisible. */
  traces?: readonly AttemptTrace[];
  /** Present means this run failed; absent means it succeeded. */
  error?: unknown;
  /** Extra structured context: repair notes, acceptable_en counts, ... */
  details?: Record<string, unknown>;
};

/**
 * Records one generation *run* — success or failure — in
 * `generation_attempts`. One row per run rather than per HTTP call, so the
 * failure rate has the right denominator; retried calls land in
 * `details.attempts` instead of inflating the count.
 *
 * Never throws. A failure to log must not fail the caller's actual work, let
 * alone its error path (services.md §5: the drill path never depends on an
 * analytical write). Returns the category on failure, null on success, so
 * callers can use it without reclassifying.
 */
export async function logGenerationAttempt(
  supabase: DbClient,
  params: LogParams,
): Promise<ErrorCategory | null> {
  const failed = params.error !== undefined;
  const category = failed ? classifyError(params.error) : null;

  const details: Record<string, unknown> = { ...(params.details ?? {}) };
  if (failed) {
    const fromError = errorDetails(params.error);
    if (fromError) Object.assign(details, fromError);
  }
  if (params.traces?.length) details.attempts = params.traces;

  try {
    await supabase.from("generation_attempts").insert({
      outcome: failed ? "failure" : "success",
      stage: params.stage,
      source: params.source,
      category,
      scenario_id: params.scenarioId ?? null,
      variant_id: params.variantId ?? null,
      level: params.level ?? null,
      message: failed ? errorMessage(params.error) : null,
      http_status: failed ? errorHttpStatus(params.error) : null,
      duration_ms: params.durationMs ?? null,
      attempt_count: params.attemptCount ?? 1,
      details: (Object.keys(details).length > 0 ? (details as Json) : null) as Json,
    });
  } catch (logErr) {
    console.error("[content-generation] failed to write generation_attempts row", logErr);
  }

  return category;
}
