// Three graduated hint tiers, matching the reference UX exactly: gist, then
// the key word, then the kana/romaji reading — never `en`. The learner still
// has to translate it themselves even at max hint. Hints stack: at tier 2
// you see both the gist and the key word.
//
// Pure and DB-free (no "server-only" — DrillClient calls this directly,
// since the line data needed is already loaded client-side for TTS).
export type HintLine = {
  gist: string | null;
  key_ja: string | null;
  key_romaji: string | null;
  key_en: string | null;
  kana: string | null;
  romaji: string | null;
};

export type Hint =
  | { tier: 1; label: "What it's about"; gist: string }
  | { tier: 2; label: "Key word"; keyJa: string; keyRomaji: string | null; keyEn: string }
  | { tier: 3; label: "What was said"; kana: string; romaji: string };

export const MAX_HINT_TIER = 3;

export function hintsUpTo(line: HintLine, tier: number): Hint[] {
  const hints: Hint[] = [];
  if (tier >= 1 && line.gist) {
    hints.push({ tier: 1, label: "What it's about", gist: line.gist });
  }
  if (tier >= 2 && line.key_ja && line.key_en) {
    hints.push({
      tier: 2,
      label: "Key word",
      keyJa: line.key_ja,
      keyRomaji: line.key_romaji,
      keyEn: line.key_en,
    });
  }
  if (tier >= 3 && line.kana && line.romaji) {
    hints.push({ tier: 3, label: "What was said", kana: line.kana, romaji: line.romaji });
  }
  return hints;
}
