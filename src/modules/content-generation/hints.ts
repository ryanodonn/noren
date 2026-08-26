// Static, graduated hints built from the authored line fields — no LLM.
// Translation-direction order: the hardest single word's gloss first (a
// small assist), then a fuller context clue, then the full translation.
// Depth 0 can't lead with `gist` here — it was authored as a near-paraphrase
// of the line, which would hand over the whole answer immediately.
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
  if (hintsUsedSoFar === 0 && line.key_ja && line.key_en) {
    return `"${line.key_ja}"${line.key_romaji ? ` (${line.key_romaji})` : ""} means "${line.key_en}"`;
  }
  if (hintsUsedSoFar <= 1 && line.gist) {
    return `Context: ${line.gist}`;
  }
  return `Full translation: ${line.en}`;
}
