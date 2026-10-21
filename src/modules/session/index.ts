import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId, Verdict } from "@/lib/types";
import * as db from "./db";
import * as Catalog from "@/modules/catalog";
import * as ContentGeneration from "@/modules/content-generation";
import * as Vocabulary from "@/modules/vocabulary";
import * as Progression from "@/modules/progression";

/** Cross-module calls after a write commits are individually isolated —
 * a failure in an analytical module must never fail the learner's write
 * (services.md §4-5). */
async function callSideEffect(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[session] ${label} failed`, err);
  }
}

/** Why a session couldn't start, in terms the UI can phrase for a learner. */
export type StartSessionFailureReason = "pool_empty" | "no_variants";

/**
 * Wraps the ways startSession can fail so callers depend on Session's error
 * type alone rather than reaching for ContentGeneration's as well.
 */
export class StartSessionError extends Error {
  constructor(
    readonly reason: StartSessionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "StartSessionError";
  }
}

export async function startSession(
  supabase: DbClient,
  params: {
    userId: string;
    scenarioId: string;
    level: LevelId;
    mode: "conversation" | "listening";
    variantId?: string;
    isReplay?: boolean;
  },
) {
  let variantId = params.variantId;
  let isReplay = params.isReplay ?? false;

  if (!variantId) {
    const next = await Catalog.getNextVariant(
      supabase,
      params.scenarioId,
      params.userId,
      params.level,
    );
    if (next) {
      variantId = next.id;
    } else {
      const replay = await Catalog.resetScenario(
        supabase,
        params.scenarioId,
        params.userId,
        params.level,
      );
      if (!replay) {
        throw new StartSessionError(
          "no_variants",
          "This scenario has no variants to play at this level.",
        );
      }
      variantId = replay.id;
      isReplay = true;
    }
  }

  const [scenario, level, variant] = await Promise.all([
    Catalog.getScenario(supabase, params.scenarioId),
    Catalog.getLevel(supabase, params.level),
    Catalog.getVariant(supabase, variantId),
  ]);

  // Session owns `sessions`, so it reads its own history and hands
  // ContentGeneration an exclusion set rather than letting that module query
  // across the boundary (services.md §4).
  const playedDialogueIds = await db.getPlayedDialogueIds(supabase, {
    userId: params.userId,
    scenarioId: params.scenarioId,
    variantId,
    level: params.level,
  });

  let dialogue;
  let alreadyHeard;
  try {
    ({ dialogue, alreadyHeard } = await ContentGeneration.getDialogue(
      supabase,
      scenario,
      variant,
      level,
      { excludeDialogueIds: playedDialogueIds },
    ));
  } catch (err) {
    if (err instanceof ContentGeneration.PoolEmptyError) {
      throw new StartSessionError(
        "pool_empty",
        "No dialogue is pooled for this scene at this level yet.",
      );
    }
    throw err;
  }

  const session = await db.insertSession(supabase, {
    userId: params.userId,
    mode: params.mode,
    scenarioId: params.scenarioId,
    variantId,
    level: params.level,
    dialogueId: dialogue.id,
    isReplay,
  });

  return { session, dialogue, scenario, alreadyHeard };
}

/**
 * `alreadyHeard` is recomputed here rather than stored, so it survives a
 * reload with no new column. Note it deliberately does **not** reuse
 * `sessions.is_replay`: that already means "variant-level replay after the
 * scenario was exhausted" and feeds Catalog.markScenarioCompletion,
 * Progression.evaluate, and the is_replay filter behind "areas to improve" —
 * overloading it would quietly corrupt progression evidence.
 */
export async function getSession(supabase: DbClient, sessionId: string) {
  const session = await db.getSession(supabase, sessionId);
  const [dialogue, scenario, priorPlays] = await Promise.all([
    ContentGeneration.getDialogueById(supabase, session.dialogue_id!),
    Catalog.getScenario(supabase, session.scenario_id),
    session.dialogue_id
      ? db.countPriorPlays(supabase, {
          userId: session.user_id,
          dialogueId: session.dialogue_id,
          before: session.started_at,
        })
      : Promise.resolve(0),
  ]);
  return { session, dialogue, scenario, alreadyHeard: priorPlays > 0 };
}

export async function recordAttempt(
  supabase: DbClient,
  params: {
    userId: string;
    sessionId: string;
    lineId: string;
    seq: number;
    userAnswer: string | null;
    verdict: Verdict | null;
    hintsUsed: number;
    note: string | null;
    latencyMs: number | null;
    /** The grader's raw similarity score, for threshold tuning later. */
    score?: number | null;
  },
) {
  await db.insertAttempt(supabase, params);

  const line = await ContentGeneration.getLine(supabase, params.lineId);
  await callSideEffect("Vocabulary.harvestFromAttempt", () =>
    Vocabulary.harvestFromAttempt(supabase, {
      userId: params.userId,
      verdict: params.verdict,
      tokens: (line.tokens as { ja: string; kana?: string; romaji?: string; en?: string }[]) ?? [],
      contextSentenceJa: line.ja,
    }),
  );
}

export async function recordLookup(
  supabase: DbClient,
  params: {
    userId: string;
    sessionId: string;
    tokenJa: string;
    kana?: string | null;
    romaji?: string | null;
    en?: string | null;
  },
) {
  await db.insertLookup(supabase, params);

  await callSideEffect("Vocabulary.harvestFromLookup", () =>
    Vocabulary.harvestFromLookup(supabase, {
      userId: params.userId,
      tokenJa: params.tokenJa,
      kana: params.kana,
      romaji: params.romaji,
      en: params.en,
    }),
  );
}

export async function getSummary(supabase: DbClient, sessionId: string) {
  return db.getSessionSummary(supabase, sessionId);
}

/** Consecutive calendar days (UTC) with a completed session, walking back
 * from today. Today may be absent without breaking the streak — it just
 * anchors the walk at yesterday instead, so the count doesn't visibly drop
 * to zero before the learner has had a chance to play today. */
function computeStreak(completedAtIso: string[]): number {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const days = new Set(completedAtIso.map((iso) => dayKey(new Date(iso))));

  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  if (!days.has(dayKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(dayKey(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/** Below this many attempts, a scenario's got-it rate is too noisy to call
 * out as a weak spot — one bad line in a 3-attempt scenario isn't a trend. */
const MIN_ATTEMPTS_FOR_WEAK_SCENARIO = 5;

/** The scenario with the lowest got-it rate among those played enough to
 * mean something, or null if nothing qualifies yet. */
export async function getWeakestScenario(supabase: DbClient, userId: string) {
  const rows = await db.getAttemptsByScenario(supabase, userId);

  const byScenario = new Map<string, { total: number; gotIt: number; totalHints: number }>();
  for (const row of rows) {
    const bucket = byScenario.get(row.scenario_id) ?? { total: 0, gotIt: 0, totalHints: 0 };
    for (const a of row.attempts) {
      bucket.total++;
      if (a.verdict === "got_it") bucket.gotIt++;
      bucket.totalHints += a.hints_used;
    }
    byScenario.set(row.scenario_id, bucket);
  }

  let weakest: { scenarioId: string; total: number; gotItRate: number; meanHints: number } | null =
    null;
  for (const [scenarioId, s] of byScenario) {
    if (s.total < MIN_ATTEMPTS_FOR_WEAK_SCENARIO) continue;
    const gotItRate = s.gotIt / s.total;
    if (!weakest || gotItRate < weakest.gotItRate) {
      weakest = { scenarioId, total: s.total, gotItRate, meanHints: s.totalHints / s.total };
    }
  }
  return weakest;
}

export async function getStats(supabase: DbClient, userId: string) {
  const [totalSessions, completedDates] = await Promise.all([
    db.countCompletedSessions(supabase, userId),
    db.getCompletedSessionDates(supabase, userId),
  ]);
  return {
    totalSessions,
    currentStreak: computeStreak(completedDates),
    lastSessionAt: completedDates[0] ?? null,
  };
}

export async function completeSession(
  supabase: DbClient,
  params: { userId: string; sessionId: string; abandoned?: boolean },
) {
  const abandoned = params.abandoned ?? false;
  await db.completeSession(supabase, params.sessionId, abandoned);

  const session = await db.getSession(supabase, params.sessionId);
  const { summary, missedLines } = await db.getSessionSummary(supabase, params.sessionId);

  if (!abandoned) {
    await callSideEffect("Catalog.markScenarioCompletion", () =>
      Catalog.markScenarioCompletion(supabase, {
        userId: params.userId,
        scenarioId: session.scenario_id,
        variantId: session.variant_id,
        level: session.level,
        score: summary.got_it,
        isReplay: session.is_replay,
      }),
    );
  }

  let recommendation = null;
  await callSideEffect("Progression.evaluate", async () => {
    recommendation = await Progression.evaluate(supabase, params.userId, {
      level: session.level,
      isReplay: session.is_replay,
      abandoned,
    });
  });

  return { summary, missedLines, recommendation };
}
