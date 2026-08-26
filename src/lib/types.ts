// Shared primitive types referenced across module boundaries. Levels are
// data (see the `levels` table), so LevelId is just a string FK, not a
// hardcoded union — the whole point of docs/requirements.md's "levels are
// data, not code" decision.
export type LevelId = string;

export type Verdict = "got_it" | "close" | "missed";

export type Token = {
  ja: string;
  kana?: string;
  romaji?: string;
  en?: string;
};
