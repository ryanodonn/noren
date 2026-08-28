import { ApiError } from "@google/genai";
import { ModelJsonParseError } from "@/lib/parse-model-json";
import { DialogueValidationError } from "./validation";

/**
 * Fixed vocabulary for what can go wrong building a dialogue, not free-text
 * guessing — lets "how often does izakaya fail at N4" be a query instead of
 * a grep through logs. Mirrors the generation_errors.category check
 * constraint; keep both in sync.
 */
export type ErrorCategory =
  | "quota_exceeded" // Gemini free-tier rate limit (HTTP 429)
  | "model_unavailable" // model name deprecated/not found (HTTP 404)
  | "auth_error" // bad/revoked API key (HTTP 401/403)
  | "network_error" // transport failure or Gemini 5xx
  | "empty_response" // Gemini returned no text at all
  | "parse_error" // response wasn't valid JSON even after fence-stripping
  | "validation_error" // valid JSON, but wrong shape (line count, alternation, tokens)
  | "db_error" // the Postgres insert itself failed
  | "unknown";

export type ErrorStage = "generation" | "grading" | "pool_top_up";

const POSTGRES_SQLSTATE = /^[0-9A-Z]{5}$/;

export function classifyError(err: unknown): ErrorCategory {
  if (err instanceof ModelJsonParseError) return "parse_error";
  if (err instanceof DialogueValidationError) return "validation_error";

  if (err instanceof ApiError) {
    if (err.status === 429) return "quota_exceeded";
    if (err.status === 404) return "model_unavailable";
    if (err.status === 401 || err.status === 403) return "auth_error";
    if (err.status >= 500) return "network_error";
    return "unknown";
  }

  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string" && POSTGRES_SQLSTATE.test(code)) return "db_error";
  }

  if (err instanceof Error) {
    if (/empty response/i.test(err.message)) return "empty_response";
    if (/fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(err.message)) return "network_error";
  }

  return "unknown";
}
