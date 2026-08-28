export class DialogueValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Generated dialogue failed validation: ${issues.join("; ")}`);
    this.name = "DialogueValidationError";
  }
}

type LineToValidate = {
  speaker?: string;
  ja?: string;
  kana?: string;
  romaji?: string;
  en?: string;
  gist?: string;
  tokens?: { ja?: string }[];
};

/**
 * Same checks scripts/seed-content/build-sql.mjs runs on hand-authored
 * content, applied to live Gemini output before it ever reaches the pool —
 * a malformed row here means broken tap-to-reveal for every learner who
 * draws it later, not just a one-time generation failure.
 */
export function validateGeneratedDialogue(parsed: {
  setting?: string;
  lines?: LineToValidate[];
}): void {
  const issues: string[] = [];

  if (!parsed.setting) issues.push("missing setting");

  const lines = parsed.lines;
  if (!Array.isArray(lines) || lines.length < 6 || lines.length > 8) {
    issues.push(`lines must be 6-8, got ${lines?.length ?? "none"}`);
  }

  (lines ?? []).forEach((line, i) => {
    const expectedSpeaker = i % 2 === 0 ? "a" : "b";
    if (line.speaker !== expectedSpeaker) {
      issues.push(`line ${i}: expected speaker "${expectedSpeaker}", got "${line.speaker}"`);
    }
    for (const field of ["ja", "kana", "romaji", "en", "gist"] as const) {
      if (!line[field]) issues.push(`line ${i}: missing "${field}"`);
    }
    if (!Array.isArray(line.tokens) || line.tokens.length === 0) {
      issues.push(`line ${i}: missing tokens`);
    } else {
      const reconstructed = line.tokens.map((t) => t.ja ?? "").join("");
      if (reconstructed !== line.ja) {
        issues.push(`line ${i}: tokens do not reconstruct ja exactly`);
      }
    }
  });

  if (issues.length > 0) throw new DialogueValidationError(issues);
}
