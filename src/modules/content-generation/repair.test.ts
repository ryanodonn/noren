import { describe, it, expect } from "vitest";
import { realignTokensToJa, normalizeAcceptableEn, repairGeneratedDialogue } from "./repair";
import type { Token } from "@/lib/types";

function toks(...jas: string[]): Token[] {
  return jas.map((ja) => ({ ja }));
}

describe("realignTokensToJa", () => {
  it("passes through tokens that already reconstruct the line", () => {
    const out = realignTokensToJa("いらっしゃいませ", toks("いらっしゃいませ"));
    expect(out?.map((t) => t.ja).join("")).toBe("いらっしゃいませ");
  });

  it("absorbs whitespace present only in ja", () => {
    const out = realignTokensToJa("温め ますか", toks("温め", "ますか"));
    expect(out).not.toBeNull();
    expect(out!.map((t) => t.ja).join("")).toBe("温め ますか");
  });

  it("absorbs an ideographic space present only in ja", () => {
    const out = realignTokensToJa("袋は　いりますか", toks("袋は", "いりますか"));
    expect(out!.map((t) => t.ja).join("")).toBe("袋は　いりますか");
  });

  it("drops whitespace present only in the tokens", () => {
    const out = realignTokensToJa("袋はいりますか", toks("袋は ", "いりますか"));
    expect(out!.map((t) => t.ja).join("")).toBe("袋はいりますか");
  });

  it("hangs trailing whitespace off the last token", () => {
    const out = realignTokensToJa("はい 　", toks("はい"));
    expect(out!.map((t) => t.ja).join("")).toBe("はい 　");
  });

  it("preserves the glosses on each token", () => {
    const out = realignTokensToJa("袋は いりますか", [
      { ja: "袋は", kana: "ふくろは", romaji: "fukuro wa", en: "bag" },
      { ja: "いりますか", romaji: "irimasu ka", en: "do you need" },
    ]);
    expect(out![0]).toMatchObject({ kana: "ふくろは", romaji: "fukuro wa", en: "bag" });
    expect(out![1]).toMatchObject({ romaji: "irimasu ka", en: "do you need" });
  });

  it("always produces tokens that reconstruct ja exactly on success", () => {
    const ja = "あ い　うえ お";
    const out = realignTokensToJa(ja, toks("あ", "い", "うえ", "お"));
    expect(out!.map((t) => t.ja).join("")).toBe(ja);
  });

  it("refuses a dropped morpheme", () => {
    expect(realignTokensToJa("袋はいりますか", toks("袋は"))).toBeNull();
  });

  it("refuses a hallucinated morpheme", () => {
    expect(realignTokensToJa("袋は", toks("袋は", "いりますか"))).toBeNull();
  });

  it("refuses reordering", () => {
    expect(realignTokensToJa("袋はいりますか", toks("いりますか", "袋は"))).toBeNull();
  });

  it("refuses a full-width/half-width difference", () => {
    // NFKC would fold these, but ￥ and ¥ are different characters on screen.
    expect(realignTokensToJa("￥300", toks("¥300"))).toBeNull();
  });

  it("refuses a kana/kanji substitution", () => {
    expect(realignTokensToJa("袋はいりますか", toks("ふくろは", "いりますか"))).toBeNull();
  });

  it("returns null for empty tokens", () => {
    expect(realignTokensToJa("はい", [])).toBeNull();
    expect(realignTokensToJa("はい", toks("", " "))).toBeNull();
  });
});

describe("normalizeAcceptableEn", () => {
  it("trims and drops blanks", () => {
    expect(normalizeAcceptableEn(["  yes please  ", "", "   "])).toEqual(["yes please"]);
  });

  it("dedupes on grading's normalization", () => {
    expect(normalizeAcceptableEn(["Yes, please!", "yes please"])).toEqual(["Yes, please!"]);
  });

  it("ignores non-strings and non-arrays", () => {
    expect(normalizeAcceptableEn([1, null, "ok"])).toEqual(["ok"]);
    expect(normalizeAcceptableEn("not an array")).toEqual([]);
    expect(normalizeAcceptableEn(undefined)).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => `phrasing ${i}`);
    expect(normalizeAcceptableEn(many).length).toBe(8);
  });
});

describe("repairGeneratedDialogue", () => {
  it("realigns tokens and reports a note", () => {
    const { value, notes } = repairGeneratedDialogue({
      setting: "a konbini counter",
      lines: [{ ja: "袋は いりますか", tokens: toks("袋は", "いりますか") }],
    });
    expect(value.lines![0].tokens!.map((t) => t.ja).join("")).toBe("袋は いりますか");
    expect(notes).toEqual([{ kind: "tokens_realigned", line: 0 }]);
  });

  it("leaves an already-valid line and its notes alone", () => {
    const { value, notes } = repairGeneratedDialogue({
      setting: "a konbini counter",
      lines: [{ ja: "はい", tokens: toks("はい") }],
    });
    expect(value.lines![0].tokens).toEqual(toks("はい"));
    expect(notes).toEqual([]);
  });

  it("leaves an unrepairable line untouched so validation still rejects it", () => {
    const { value, notes } = repairGeneratedDialogue({
      lines: [{ ja: "袋はいりますか", tokens: toks("ちがいます") }],
    });
    expect(value.lines![0].tokens).toEqual(toks("ちがいます"));
    expect(notes).toEqual([]);
  });

  it("normalizes acceptable_en and reports the change", () => {
    const { value, notes } = repairGeneratedDialogue({
      lines: [{ ja: "はい", tokens: toks("はい"), acceptable_en: ["yes", "Yes!", "  "] }],
    });
    expect(value.lines![0].acceptable_en).toEqual(["yes"]);
    expect(notes).toEqual([{ kind: "acceptable_en_normalized", line: 0, from: 3, to: 1 }]);
  });

  it("never touches speaker labels", () => {
    const { value } = repairGeneratedDialogue({
      lines: [
        { speaker: "b", ja: "はい", tokens: toks("はい") },
        { speaker: "a", ja: "どうぞ", tokens: toks("どうぞ") },
      ],
    });
    expect(value.lines!.map((l) => l.speaker)).toEqual(["b", "a"]);
  });

  it("tolerates a dialogue with no lines", () => {
    expect(repairGeneratedDialogue({ setting: "x" }).notes).toEqual([]);
  });
});
