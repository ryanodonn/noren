// Pure promote/demote decision logic (services.md §2.6), deliberately kept
// free of any DB/IO so it's directly unit-testable against synthetic attempt
// streams — services.md calls this out explicitly as a reason to isolate
// Progression from the rest of the app.

export const ROLLING_WINDOW = 30;
export const MIN_ATTEMPTS = 20;
export const DISMISS_COOLDOWN_ATTEMPTS = 20;

export type AttemptForEvaluation = { verdict: string | null; hints_used: number };

export type Recommendation =
  | { type: "promote"; reason: string }
  | { type: "demote"; reason: string }
  | null;

export function computeStats(attempts: AttemptForEvaluation[]) {
  const total = attempts.length;
  if (total === 0) {
    return { total, unaidedRate: 0, missedRate: 0, meanHints: 0 };
  }
  const unaidedCorrect = attempts.filter(
    (a) => a.verdict === "got_it" && a.hints_used === 0,
  ).length;
  const missed = attempts.filter((a) => a.verdict === "missed").length;
  const totalHints = attempts.reduce((sum, a) => sum + a.hints_used, 0);

  return {
    total,
    unaidedRate: unaidedCorrect / total,
    missedRate: missed / total,
    meanHints: totalHints / total,
  };
}

export function computeRecommendation(input: {
  attempts: AttemptForEvaluation[];
  sessionsAtLevel: number;
  distinctScenarios: number;
  hasNextLevel: boolean;
  hasPrevLevel: boolean;
  consecutiveAbandoned: number;
  abandoned: boolean;
}): Recommendation {
  const { total, unaidedRate, missedRate, meanHints } = computeStats(input.attempts);

  if (total < MIN_ATTEMPTS) return null;

  const promoteEligible =
    !input.abandoned &&
    input.hasNextLevel &&
    unaidedRate >= 0.75 &&
    meanHints <= 0.5 &&
    missedRate <= 0.1 &&
    input.sessionsAtLevel >= 3 &&
    input.distinctScenarios >= 2;

  if (promoteEligible) {
    return {
      type: "promote",
      reason: `${Math.round(unaidedRate * 100)}% unaided over your last ${total} lines`,
    };
  }

  const demoteEligible =
    input.hasPrevLevel &&
    (missedRate >= 0.4 || meanHints >= 2.0 || input.consecutiveAbandoned >= 2);

  if (demoteEligible) {
    return {
      type: "demote",
      reason:
        input.consecutiveAbandoned >= 2
          ? "a couple of sessions dropped at this level"
          : "this level's been rough lately",
    };
  }

  return null;
}
