import { describe, it, expect } from "vitest";
import { ApiError } from "@google/genai";
import { classifyError, errorHttpStatus, errorDetails, parseQuotaError } from "./classify-error";
import { ModelJsonParseError } from "@/lib/parse-model-json";
import { DialogueValidationError } from "./validation";

/** Abridged from a real logged 429 body. */
const PER_MINUTE_429 =
  'You exceeded your current quota. To monitor your current usage, head to: ' +
  'https://ai.dev/rate-limit. \\n* Quota exceeded for metric: ' +
  'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, ' +
  'model: gemini-3.6-flash\\nPlease retry in 9.614598867s.","status":"RESOURCE_EXHAUSTED",' +
  '"details":[{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":' +
  '[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]';

const PER_DAY_429 =
  'Quota exceeded for metric: generativelanguage.googleapis.com/' +
  'generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\\n' +
  'Please retry in 31.2s.","violations":' +
  '[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]';

describe("classifyError", () => {
  it("maps a 429 ApiError to quota_exceeded", () => {
    expect(classifyError(new ApiError({ message: "rate limited", status: 429 }))).toBe(
      "quota_exceeded",
    );
  });

  it("maps a 404 ApiError to model_unavailable", () => {
    expect(classifyError(new ApiError({ message: "not found", status: 404 }))).toBe(
      "model_unavailable",
    );
  });

  it("maps 401 and 403 ApiErrors to auth_error", () => {
    expect(classifyError(new ApiError({ message: "unauthorized", status: 401 }))).toBe(
      "auth_error",
    );
    expect(classifyError(new ApiError({ message: "forbidden", status: 403 }))).toBe("auth_error");
  });

  it("maps a 5xx ApiError to network_error", () => {
    expect(classifyError(new ApiError({ message: "server error", status: 503 }))).toBe(
      "network_error",
    );
  });

  it("maps an unrecognized ApiError status to unknown", () => {
    expect(classifyError(new ApiError({ message: "teapot", status: 418 }))).toBe("unknown");
  });

  it("maps ModelJsonParseError to parse_error", () => {
    expect(classifyError(new ModelJsonParseError("not json"))).toBe("parse_error");
  });

  it("maps DialogueValidationError to validation_error", () => {
    expect(classifyError(new DialogueValidationError(["bad shape"]))).toBe("validation_error");
  });

  it("maps a Postgres error (5-char SQLSTATE code) to db_error", () => {
    expect(classifyError({ code: "23505", message: "duplicate key" })).toBe("db_error");
  });

  it("maps an explicit empty-response Error to empty_response", () => {
    expect(classifyError(new Error("Empty response from Gemini"))).toBe("empty_response");
  });

  it("maps a fetch-failure message to network_error", () => {
    expect(classifyError(new Error("fetch failed"))).toBe("network_error");
  });

  it("falls back to unknown for anything unrecognized", () => {
    expect(classifyError(new Error("something bizarre happened"))).toBe("unknown");
    expect(classifyError("a bare string")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
  });
});

describe("parseQuotaError", () => {
  it("reads the per-minute cap from the quotaId, not the limit number", () => {
    const quota = parseQuotaError(PER_MINUTE_429);
    expect(quota.limitKind).toBe("per_minute");
    expect(quota.quotaLimit).toBe(5);
    expect(quota.retryAfterSeconds).toBeCloseTo(9.6146, 3);
  });

  it("reads the per-day cap", () => {
    const quota = parseQuotaError(PER_DAY_429);
    expect(quota.limitKind).toBe("per_day");
    expect(quota.quotaLimit).toBe(20);
    expect(quota.retryAfterSeconds).toBeCloseTo(31.2, 3);
  });

  it("reports unknown rather than guessing when the body carries no quotaId", () => {
    const quota = parseQuotaError("Quota exceeded, limit: 5");
    expect(quota.limitKind).toBe("unknown");
    expect(quota.quotaLimit).toBe(5);
  });

  it("returns nulls for a message with no quota facts at all", () => {
    expect(parseQuotaError("something else went wrong")).toEqual({
      quotaLimit: null,
      retryAfterSeconds: null,
      quotaId: null,
      limitKind: "unknown",
    });
  });
});

describe("errorHttpStatus", () => {
  it("reports the status of a Gemini ApiError", () => {
    expect(errorHttpStatus(new ApiError({ message: "nope", status: 503 }))).toBe(503);
  });

  it("is null for anything that is not an ApiError", () => {
    expect(errorHttpStatus(new Error("boom"))).toBeNull();
    expect(errorHttpStatus(null)).toBeNull();
  });
});

describe("errorDetails", () => {
  it("keeps every validation issue, not just the joined message", () => {
    const issues = ['line 0: expected speaker "a", got "b"', "line 3: missing gist"];
    expect(errorDetails(new DialogueValidationError(issues))).toEqual({ issues });
  });

  it("keeps the unparseable payload", () => {
    expect(errorDetails(new ModelJsonParseError("not json at all"))).toEqual({
      raw: "not json at all",
    });
  });

  it("truncates an oversized payload", () => {
    const details = errorDetails(new ModelJsonParseError("x".repeat(10_000)));
    expect((details!.raw as string).length).toBe(4000);
  });

  it("keeps the quota facts off a 429", () => {
    const details = errorDetails(new ApiError({ message: PER_MINUTE_429, status: 429 }));
    expect(details).toMatchObject({ limitKind: "per_minute", quotaLimit: 5 });
  });

  it("is null when there is nothing structured to keep", () => {
    expect(errorDetails(new Error("boom"))).toBeNull();
    expect(errorDetails(new ApiError({ message: "service unavailable", status: 503 }))).toBeNull();
    expect(errorDetails(null)).toBeNull();
  });
});
