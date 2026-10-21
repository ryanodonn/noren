import { describe, it, expect } from "vitest";
import { expandPhrasings } from "./phrasings";
import { normalize } from "./grading";

/** Candidates are only ever compared through `similarity`, which lowercases
 *  and strips punctuation — so assert on normalized forms, the way grading
 *  actually consumes these. */
function normalizedSet(text: string): Set<string> {
  return new Set(expandPhrasings(text).map(normalize));
}

describe("expandPhrasings", () => {
  it("always includes the original text", () => {
    expect(expandPhrasings("here you go")).toContain("here you go");
  });

  it("expands a contraction", () => {
    expect(normalizedSet("I'd like a bag")).toContain("i would like a bag");
  });

  it("contracts an expanded form", () => {
    expect(normalizedSet("I would like a bag")).toContain("id like a bag");
  });

  it("chains rules breadth-first", () => {
    // i'd -> i would, then "would like" -> "want"
    expect(normalizedSet("I'd like a bag")).toContain("i want a bag");
  });

  it("matches a contraction whether or not the apostrophe is typed", () => {
    expect(normalizedSet("dont heat it")).toContain("do not heat it");
    expect(normalizedSet("don't heat it")).toContain("do not heat it");
  });

  it("does not match a contraction inside a longer word", () => {
    // "did" must not be read as the "i'd" rule firing inside it.
    expect(expandPhrasings("did you heat it")).toEqual(["did you heat it"]);
  });

  it("handles several contractions in one line", () => {
    expect(normalizedSet("I'd like it but it's not heated")).toContain(
      "i would like it but it is not heated",
    );
  });

  it("returns no duplicates", () => {
    const out = expandPhrasings("it's fine, isn't it");
    expect(new Set(out).size).toBe(out.length);
  });

  it("leaves text with no applicable rule untouched", () => {
    expect(expandPhrasings("two hundred yen please")).toEqual(["two hundred yen please"]);
  });

  it("bounds its output", () => {
    const out = expandPhrasings("I'd say it's fine, don't you think, I've got it, let's go");
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it("matches case-insensitively, rewriting the matched span in lower case", () => {
    // Harmless: grading lowercases every candidate before comparing.
    expect(expandPhrasings("It's fine")).toContain("it is fine");
  });
});
