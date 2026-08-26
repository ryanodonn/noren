// Templated debrief — no LLM. Summarizes the session's own numbers rather
// than generating prose about them.
export function buildDebrief(params: {
  scenarioNameEn: string;
  summary: { got_it: number; close: number; missed: number; total_hints: number };
  missedLines: { en: string; note: string | null }[];
}): string {
  const { summary, missedLines, scenarioNameEn } = params;
  const total = summary.got_it + summary.close + summary.missed;

  if (total === 0) {
    return `You made it through ${scenarioNameEn} — nothing graded yet.`;
  }

  if (summary.missed === 0 && summary.close === 0) {
    return `Clean run through ${scenarioNameEn} — ${summary.got_it} for ${summary.got_it}, no hints needed to spare.`;
  }

  const lines = missedLines
    .slice(0, 3)
    .map((l) => `"${l.en}"`)
    .join(", ");

  return (
    `You got ${summary.got_it} of ${total} without help in ${scenarioNameEn}` +
    (summary.total_hints > 0 ? ` (${summary.total_hints} hints used)` : "") +
    `. ${summary.missed + summary.close > 0 ? `Worth another look: ${lines}.` : ""}`
  ).trim();
}
