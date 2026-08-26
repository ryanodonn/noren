// Rule-based grading — no LLM. Compares a learner's typed/spoken answer
// against an authored set of acceptable answers per line (see
// docs/services.md §2.3). Kept pure/DB-free so it's directly unit-testable,
// matching the Progression/Vocabulary algorithm split.
import type { Verdict } from "@/lib/types";

const CLOSE_THRESHOLD = 0.6;

const PUNCTUATION = /[。、！？!?.,\s　]/g;

export function normalize(text: string): string {
  return text.trim().toLowerCase().replace(PUNCTUATION, "");
}

/** True if the answer looks like romaji (no kana/kanji) rather than Japanese script. */
export function looksLikeRomaji(text: string): boolean {
  return !/[぀-ヿ㐀-鿿]/.test(text);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** 1.0 = identical, 0.0 = completely different. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function bestSimilarity(answer: string, candidates: string[]): number {
  if (candidates.length === 0) return 0;
  const normalizedAnswer = normalize(answer);
  return Math.max(...candidates.map((c) => similarity(normalizedAnswer, normalize(c))));
}

export function gradeAnswer(params: {
  userAnswer: string;
  acceptableJa: string[];
  acceptableRomaji: string[];
}): { verdict: Verdict; note: string | null } {
  const candidates = looksLikeRomaji(params.userAnswer)
    ? params.acceptableRomaji
    : params.acceptableJa;

  // No authored acceptable answers for this line/script — can't grade it.
  // Falls back to the other script's set rather than auto-failing, in case
  // the learner switched scripts mid-answer.
  const pool = candidates.length > 0 ? candidates : [...params.acceptableJa, ...params.acceptableRomaji];

  const score = bestSimilarity(params.userAnswer, pool);

  if (score >= 0.97) return { verdict: "got_it", note: null };
  if (score >= CLOSE_THRESHOLD) {
    return { verdict: "close", note: "Close — check the expected answer below." };
  }
  return { verdict: "missed", note: "Not quite — check the expected answer below." };
}
