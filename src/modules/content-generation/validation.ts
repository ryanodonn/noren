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

  // Strict alternation, but *either* speaker may open. `speaker` is a role
  // binding ("a" is scenario.speaker_a — the clerk, the driver), not a turn
  // index, so a dialogue that opens on "b" just means the customer spoke
  // first. That is a perfectly good scene to walk in on, and nothing
  // downstream depends on line 0 being "a" (`seq` comes from array order).
  // Relabeling b->a to force the old invariant would silently reassign every
  // utterance to the wrong speaker, with the wrong name, colour and voice in
  // DrillClient — exactly the broken-row-in-the-pool failure this file
  // exists to prevent. Non-alternating output ("aabb", "aaa") still fails.
  const opener = (lines ?? [])[0]?.speaker;
  if (lines?.length && opener !== "a" && opener !== "b") {
    issues.push(`line 0: speaker must be "a" or "b", got "${opener}"`);
  }
  const second = opener === "a" ? "b" : "a";

  (lines ?? []).forEach((line, i) => {
    if (opener === "a" || opener === "b") {
      const expectedSpeaker = i % 2 === 0 ? opener : second;
      if (line.speaker !== expectedSpeaker) {
        issues.push(`line ${i}: expected speaker "${expectedSpeaker}", got "${line.speaker}"`);
      }
    }
    for (const field of ["ja", "kana", "romaji", "en", "gist"] as const) {
      if (!line[field]) issues.push(`line ${i}: missing "${field}"`);
    }
    if (!Array.isArray(line.tokens) || line.tokens.length === 0) {
      issues.push(`line ${i}: missing tokens`);
    } else {
      // Exact, deliberately: DrillClient only offers tap-to-reveal when the
      // tokens rebuild the line, so anything less means a dead line in the
      // pool. repair.ts re-slices tokens out of `ja` before this runs, which
      // absorbs the whitespace-only mismatches that used to land here.
      const reconstructed = line.tokens.map((t) => t.ja ?? "").join("");
      if (reconstructed !== line.ja) {
        issues.push(
          `line ${i}: tokens do not reconstruct ja exactly ` +
            `(got "${reconstructed}", want "${line.ja}")`,
        );
      }
    }
  });

  if (issues.length > 0) throw new DialogueValidationError(issues);
}
