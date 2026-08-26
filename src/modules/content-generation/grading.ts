// Rule-based grading — no LLM. The learner translates a Japanese line into
// English; this compares their answer against the line's own `en` field plus
// an authored `acceptable_en` set (see docs/services.md §2.3). Kept pure/
// DB-free so it's directly unit-testable, matching the Progression/
// Vocabulary algorithm split.
import type { Verdict } from "@/lib/types";

const CLOSE_THRESHOLD = 0.5;

const PUNCTUATION = /[.,!?;:'"、。！？]/g;

export function normalize(text: string): string {
  return text.trim().toLowerCase().replace(PUNCTUATION, "");
}

function words(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter(Boolean));
}

/**
 * Word-overlap (Dice coefficient) similarity: 1.0 = identical word sets,
 * 0.0 = no shared words. English translations vary in word order and length
 * far more than the fixed Japanese phrasings this app used to grade against,
 * so character-level edit distance would score legitimate paraphrases
 * ("should I warm this up?" vs. "do you want it heated?") as wildly
 * different. Word overlap tolerates reordering and filler-word differences —
 * at the honest cost of still missing same-meaning-different-words
 * paraphrases ("heat it up" vs. "warm it up" share no words). Mitigated by
 * authoring several acceptable_en phrasings per line, not by the metric.
 */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return (2 * intersection) / (wa.size + wb.size);
}

export function bestSimilarity(answer: string, candidates: string[]): number {
  if (candidates.length === 0) return 0;
  return Math.max(...candidates.map((c) => similarity(answer, c)));
}

export function gradeAnswer(params: {
  userAnswer: string;
  expectedEn: string;
  acceptableEn: string[];
}): { verdict: Verdict; note: string | null } {
  const pool = [params.expectedEn, ...params.acceptableEn];
  const score = bestSimilarity(params.userAnswer, pool);

  if (score >= 0.97) return { verdict: "got_it", note: null };
  if (score >= CLOSE_THRESHOLD) {
    return { verdict: "close", note: "Close — check the expected translation below." };
  }
  return { verdict: "missed", note: "Not quite — check the expected translation below." };
}
