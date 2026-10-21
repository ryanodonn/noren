import { ApiError } from "@google/genai";
import { ModelJsonParseError } from "@/lib/parse-model-json";
import { DialogueValidationError } from "./validation";

/**
 * Fixed vocabulary for what can go wrong building a dialogue, not free-text
 * guessing — lets "how often does izakaya fail at N4" be a query instead of
 * a grep through logs. Mirrors the generation_attempts.category check
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

/**
 * `grading` and `pool_top_up` are **historical only** — grading no longer
 * calls an LLM and the background top-up is gone (services.md §2.3). Both
 * values are kept because rows written under them still exist, and the DB
 * CHECK still accepts them. Every new row is `generation`.
 */
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

/** The HTTP status, when the failure came from the Gemini API at all. */
export function errorHttpStatus(err: unknown): number | null {
  if (err instanceof ApiError && typeof err.status === "number") return err.status;
  return null;
}

/** Which free-tier ceiling a 429 actually hit. */
export type QuotaLimitKind = "per_minute" | "per_day" | "unknown";

/**
 * Pulls the quota facts Gemini buries in a 429 body.
 *
 * This distinction is the whole ballgame: hitting the per-minute request cap
 * means "pace the calls," hitting the daily cap means "make fewer of them" —
 * opposite responses. Every one of the seed cron's 47 logged 429s was the
 * per-minute cap and not one was the daily cap, but because only
 * `category = 'quota_exceeded'` was stored, the two looked identical and the
 * cron's burst problem read as "we're out of quota" for three weeks.
 *
 * `limitKind` comes from the body's `quotaId`
 * (`GenerateRequestsPerMinutePerProjectPerModel-FreeTier`) rather than from
 * the `limit` number, because the number is not stable — Google cut the
 * per-minute limit to 5 around 2026-09-14 without the code changing.
 */
export function parseQuotaError(message: string): {
  quotaLimit: number | null;
  retryAfterSeconds: number | null;
  quotaId: string | null;
  limitKind: QuotaLimitKind;
} {
  const limit = message.match(/"?limit"?[:=]?\s*"?(\d+)/i);
  const retry = message.match(/retry in\s*([0-9.]+)\s*s/i);
  const quotaId = message.match(/"quotaId"\s*:\s*"([^"]+)"/i)?.[1] ?? null;

  const quotaLimit = limit ? Number(limit[1]) : null;
  const retryAfterSeconds = retry ? Number(retry[1]) : null;

  let limitKind: QuotaLimitKind = "unknown";
  if (quotaId && /perminute/i.test(quotaId)) limitKind = "per_minute";
  else if (quotaId && /perday/i.test(quotaId)) limitKind = "per_day";

  return {
    quotaLimit: quotaLimit !== null && Number.isFinite(quotaLimit) ? quotaLimit : null,
    retryAfterSeconds:
      retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    quotaId,
    limitKind,
  };
}

/** Raw model output is unbounded; keep enough to diagnose, not enough to bloat the row. */
const MAX_RAW_CHARS = 4000;

/**
 * The structured detail each error class carries and `err.message` alone
 * throws away — validation's individual issues, the unparseable payload, the
 * quota numbers above. Written to `generation_attempts.details`.
 */
export function errorDetails(err: unknown): Record<string, unknown> | null {
  if (err instanceof DialogueValidationError) return { issues: err.issues };
  if (err instanceof ModelJsonParseError) return { raw: err.raw.slice(0, MAX_RAW_CHARS) };
  if (err instanceof ApiError) {
    const quota = parseQuotaError(err.message);
    if (quota.quotaLimit === null && quota.retryAfterSeconds === null && !quota.quotaId) {
      return null;
    }
    return { ...quota };
  }
  return null;
}
