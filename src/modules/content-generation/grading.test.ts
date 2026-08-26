import { describe, it, expect } from "vitest";
import { normalize, looksLikeRomaji, similarity, gradeAnswer } from "./grading";

describe("normalize", () => {
  it("strips punctuation and whitespace and lowercases", () => {
    expect(normalize("袋は、いりません。")).toBe("袋はいりません");
    expect(normalize(" Fukuro Wa Irimasen! ")).toBe("fukurowairimasen");
  });
});

describe("looksLikeRomaji", () => {
  it("detects romaji input", () => {
    expect(looksLikeRomaji("fukuro wa irimasen")).toBe(true);
  });

  it("detects Japanese script input", () => {
    expect(looksLikeRomaji("袋はいりません")).toBe(false);
    expect(looksLikeRomaji("ふくろはいりません")).toBe(false);
  });
});

describe("similarity", () => {
  it("is 1 for identical strings", () => {
    expect(similarity("abc", "abc")).toBe(1);
  });

  it("is 0 for completely different strings of the same length", () => {
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("scores a one-character typo highly", () => {
    expect(similarity("irimasen", "irimasn")).toBeGreaterThan(0.8);
  });
});

describe("gradeAnswer", () => {
  const line = {
    acceptableJa: ["袋は要りません", "レジ袋は結構です"],
    acceptableRomaji: ["fukuro wa irimasen", "reji-bukuro wa kekkou desu"],
  };

  it("gets it right on an exact acceptable-answer match", () => {
    const result = gradeAnswer({ userAnswer: "袋は要りません", ...line });
    expect(result.verdict).toBe("got_it");
  });

  it("gets it right on romaji input matching a romaji acceptable answer", () => {
    const result = gradeAnswer({ userAnswer: "fukuro wa irimasen", ...line });
    expect(result.verdict).toBe("got_it");
  });

  it("is tolerant of minor typos (close or got_it, not missed)", () => {
    const result = gradeAnswer({ userAnswer: "fukuro wa irimasn", ...line });
    expect(result.verdict).not.toBe("missed");
  });

  it("misses on a completely unrelated answer", () => {
    const result = gradeAnswer({ userAnswer: "konnichiwa", ...line });
    expect(result.verdict).toBe("missed");
  });

  it("falls back to the other script's set when the input's own set is empty", () => {
    const result = gradeAnswer({
      userAnswer: "袋は要りません",
      acceptableJa: ["袋は要りません"],
      acceptableRomaji: [],
    });
    expect(result.verdict).toBe("got_it");
  });
});
