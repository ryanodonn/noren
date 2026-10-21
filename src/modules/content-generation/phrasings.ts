// Mechanical English phrasing variants — no LLM, no quota, no storage.
//
// Why this exists: grading's `got_it` threshold of 0.97 is, for any line
// short enough to appear in this app, an *exact* word-set match. For word
// sets of sizes a and b sharing k words, the Dice coefficient is
// 2k/(a+b); the best score two non-identical sets can reach is 2a/(2a+1),
// which for a five-word answer is 0.909. Clearing 0.97 therefore requires
// ~17 words. Dialogue lines here are 3-8.
//
// So "I'd like a bag" vs "I would like a bag" — the same sentence — scored
// 0.667 and graded `close`, because the normalized word sets differ by one
// token. Expanding the candidate pool over contraction and a small closed
// synonym set fixes that class of false negative for every line already in
// the pool, retroactively, at zero cost. What it cannot do is semantic
// synonymy ("heat it up" vs "warm it up" share no words) — that's what the
// generator's `acceptable_en` is for.
//
// Rules are bidirectional, so expanding only the candidates is enough; the
// learner's answer is left alone.

/** Pairs that mean the same thing. Expanded into both directions below. */
const EQUIVALENTS: readonly (readonly [string, string])[] = [
  ["i'd", "i would"],
  ["i'm", "i am"],
  ["i've", "i have"],
  ["i'll", "i will"],
  ["it's", "it is"],
  ["that's", "that is"],
  ["there's", "there is"],
  ["what's", "what is"],
  ["you're", "you are"],
  ["we're", "we are"],
  ["don't", "do not"],
  ["doesn't", "does not"],
  ["didn't", "did not"],
  ["isn't", "is not"],
  ["aren't", "are not"],
  ["can't", "cannot"],
  ["won't", "will not"],
  ["let's", "let us"],
  ["would like", "want"],
];

type Rule = { pattern: RegExp; replacement: string };

/**
 * Matches `phrase` as whole words, with any apostrophe optional — grading's
 * `normalize` strips apostrophes anyway, and learners type "dont" about as
 * often as "don't". The `\b` anchors keep "i'd" from matching inside "did".
 */
function wordPattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "'?");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

const RULES: readonly Rule[] = EQUIVALENTS.flatMap(([contracted, expanded]) => [
  { pattern: wordPattern(contracted), replacement: expanded },
  { pattern: wordPattern(expanded), replacement: contracted },
]);

/**
 * A line with several contractions can combine into many variants, and the
 * pool is only ever fed to `bestSimilarity`, so cap it. 24 covers three
 * independent contractions in one line with room to spare.
 */
const MAX_VARIANTS = 24;

/**
 * Every mechanical rewrite of `text`, including `text` itself. Breadth-first
 * so chains compose: "I'd like a bag" -> "I would like a bag" -> "I want a
 * bag".
 */
export function expandPhrasings(text: string): string[] {
  const seen = new Set<string>([text]);
  const queue: string[] = [text];

  while (queue.length > 0 && seen.size < MAX_VARIANTS) {
    const current = queue.shift()!;
    for (const rule of RULES) {
      // Always `replace` rather than `test` — these regexes carry the `g`
      // flag and are module-level, so `test` would advance `lastIndex`
      // between calls. `replace` resets it.
      const next = current.replace(rule.pattern, rule.replacement);
      if (next !== current && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
        if (seen.size >= MAX_VARIANTS) break;
      }
    }
  }

  return [...seen];
}
