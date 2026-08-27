import { describe, it, expect } from "vitest";
import { hintsUpTo } from "./hints";

const line = {
  gist: "asking about the price",
  key_ja: "値段",
  key_romaji: "nedan",
  key_en: "price",
  kana: "ねだんはいくらですか",
  romaji: "nedan wa ikura desu ka",
};

describe("hintsUpTo", () => {
  it("returns nothing at tier 0", () => {
    expect(hintsUpTo(line, 0)).toEqual([]);
  });

  it("returns only the gist at tier 1", () => {
    const hints = hintsUpTo(line, 1);
    expect(hints).toHaveLength(1);
    expect(hints[0].tier).toBe(1);
  });

  it("stacks the key word on top of the gist at tier 2", () => {
    const hints = hintsUpTo(line, 2);
    expect(hints.map((h) => h.tier)).toEqual([1, 2]);
  });

  it("stacks all three at tier 3, and never includes an english translation field", () => {
    const hints = hintsUpTo(line, 3);
    expect(hints.map((h) => h.tier)).toEqual([1, 2, 3]);
    for (const h of hints) {
      expect(h).not.toHaveProperty("en");
    }
  });

  it("skips a tier whose backing field is missing", () => {
    const partial = { ...line, key_ja: null };
    const hints = hintsUpTo(partial, 3);
    expect(hints.map((h) => h.tier)).toEqual([1, 3]);
  });
});
