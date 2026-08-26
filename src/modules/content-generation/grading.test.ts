import { describe, it, expect } from "vitest";
import { normalize, similarity, gradeAnswer } from "./grading";

describe("normalize", () => {
  it("strips punctuation and whitespace and lowercases", () => {
    expect(normalize("Yes, please!")).toBe("yes please");
    expect(normalize("  Here you go.  ")).toBe("here you go");
  });
});

describe("similarity (word overlap / Dice coefficient)", () => {
  it("is 1 for identical word sets", () => {
    expect(similarity("yes please", "Yes, please!")).toBe(1);
  });

  it("is 0 for completely different word sets", () => {
    expect(similarity("hello there", "goodbye now")).toBe(0);
  });

  it("tolerates reordering", () => {
    expect(similarity("please, yes", "yes please")).toBe(1);
  });

  it("gives partial credit for partial word overlap", () => {
    const score = similarity("here you go", "here");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("scores same-meaning-different-words paraphrases low (documented limitation)", () => {
    expect(similarity("heat it up", "warm this please")).toBeLessThan(0.5);
  });
});

describe("gradeAnswer", () => {
  const expectedEn = "Should I warm this up?";
  const acceptableEn = ["do you want it heated", "should i heat this up", "want me to warm it up"];

  it("gets it right on an exact match to the expected translation", () => {
    const result = gradeAnswer({ userAnswer: "Should I warm this up?", expectedEn, acceptableEn });
    expect(result.verdict).toBe("got_it");
  });

  it("gets it right matching an authored acceptable paraphrase", () => {
    const result = gradeAnswer({ userAnswer: "do you want it heated", expectedEn, acceptableEn });
    expect(result.verdict).toBe("got_it");
  });

  it("tolerates reordering and punctuation differences", () => {
    const result = gradeAnswer({ userAnswer: "should I heat this up", expectedEn, acceptableEn });
    expect(result.verdict).toBe("got_it");
  });

  it("misses on a completely unrelated answer", () => {
    const result = gradeAnswer({ userAnswer: "thank you very much", expectedEn, acceptableEn });
    expect(result.verdict).toBe("missed");
  });

  it("falls back to the expected translation alone when no acceptable variants are authored", () => {
    const result = gradeAnswer({
      userAnswer: "here you go",
      expectedEn: "Here you go.",
      acceptableEn: [],
    });
    expect(result.verdict).toBe("got_it");
  });
});
