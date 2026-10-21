// Rule-based grading — no LLM, and since 2026-10 the *only* grading path
// (see docs/services.md §2.3). The learner translates a Japanese line into
// English; this compares their answer against the line's own `en` field plus
// its `acceptable_en` set, each expanded over mechanical phrasing variants.
// Kept pure/DB-free so it's directly unit-testable, matching the Progression/
// Vocabulary algorithm split.
import type { Verdict } from "@/lib/types";
import { expandPhrasings } from "./phrasings";

const CLOSE_THRESHOLD = 0.5;

/**
 * Not the lenient threshold it looks like: for word sets of sizes a and b
 * sharing k words the Dice coefficient is 2k/(a+b), so the best two
 * *non-identical* sets can score is 2a/(2a+1) — 0.909 for a five-word
 * answer. Clearing 0.97 needs ~17 words, and lines here are 3-8. So for any
 * real line this is "the normalized word sets are equal", with no partial
 * credit band above `close`. That makes candidate breadth (`acceptable_en`
 * plus phrasings.ts) the entire accuracy budget — see services.md §2.3.
 */
const GOT_IT_THRESHOLD = 0.97;

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

/**
 * `score` is returned so it can be persisted on the attempt (`attempts.score`)
 * — the thresholds above were set when every line had hand-authored
 * `acceptable_en`, and retuning them should be an evidence-based decision
 * rather than a guess.
 */
export function gradeAnswer(params: {
  userAnswer: string;
  expectedEn: string;
  acceptableEn: string[];
}): { verdict: Verdict; note: string | null; score: number } {
  // Expanding only the candidates is sufficient: the phrasing rules are
  // bidirectional, so a learner's "I would like a bag" is reached from a
  // candidate "I'd like a bag" and vice versa.
  const pool = [params.expectedEn, ...params.acceptableEn].flatMap(expandPhrasings);
  const score = bestSimilarity(params.userAnswer, pool);

  if (score >= GOT_IT_THRESHOLD) return { verdict: "got_it", note: null, score };
  if (score >= CLOSE_THRESHOLD) {
    return { verdict: "close", note: "Close — check the expected translation below.", score };
  }
  return {
    verdict: "missed",
    note: "Not quite — check the expected translation below.",
    score,
  };
}
