import { describe, it, expect } from "vitest";
import { ApiError } from "@google/genai";
import { classifyError } from "./classify-error";
import { ModelJsonParseError } from "@/lib/parse-model-json";
import { DialogueValidationError } from "./validation";

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
