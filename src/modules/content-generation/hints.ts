// Static, graduated hints built from the authored line fields — no LLM.
// Mirrors the three depths the original LLM hint prompt used: a topic
// nudge, then the key word, then the answer itself.
export function buildHint(
  line: {
    gist: string | null;
    key_ja: string | null;
    key_romaji: string | null;
    key_en: string | null;
    ja: string;
    en: string;
  },
  hintsUsedSoFar: number,
): string {
  if (hintsUsedSoFar === 0) {
    return line.gist ? `Think about: ${line.gist}` : `You need to say: ${line.en}`;
  }
  if (hintsUsedSoFar === 1 && line.key_ja) {
    return `Key word: ${line.key_ja}${line.key_romaji ? ` (${line.key_romaji})` : ""}`;
  }
  return `Full answer: ${line.ja}`;
}
