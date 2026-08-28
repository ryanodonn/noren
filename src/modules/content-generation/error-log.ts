import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Json } from "@/lib/supabase/database.types";
import { classifyError, type ErrorCategory, type ErrorStage } from "./classify-error";

export type { ErrorCategory, ErrorStage };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Never throws — a failure to log must not fail the caller's actual error
 * path (services.md §5: the drill path never depends on an analytical
 * write). Returns the category so callers can use it without reclassifying.
 */
export async function logGenerationError(
  supabase: DbClient,
  params: {
    stage: ErrorStage;
    error: unknown;
    scenarioId?: string | null;
    variantId?: string | null;
    level?: string | null;
    context?: Record<string, unknown>;
  },
): Promise<ErrorCategory> {
  const category = classifyError(params.error);
  try {
    await supabase.from("generation_errors").insert({
      stage: params.stage,
      category,
      scenario_id: params.scenarioId ?? null,
      variant_id: params.variantId ?? null,
      level: params.level ?? null,
      message: errorMessage(params.error),
      context: (params.context as Json) ?? null,
    });
  } catch (logErr) {
    console.error("[content-generation] failed to write generation_errors row", logErr);
  }
  return category;
}
