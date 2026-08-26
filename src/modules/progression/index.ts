import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";
import * as db from "./db";
import { computeRecommendation, ROLLING_WINDOW, DISMISS_COOLDOWN_ATTEMPTS } from "./algorithm";

export async function getStatus(supabase: DbClient, userId: string) {
  const levelState = await db.getLevelState(supabase, userId);
  const recommendation = levelState ? await db.getPendingEvent(supabase, userId) : null;
  return { levelState, recommendation };
}

/**
 * Called by Session & Attempt after a session completes (services.md §4).
 * Never throws into the caller's write path — evaluation failures here must
 * not fail a session write (services.md §5 "the drill path never depends on
 * an analytical context").
 */
export async function evaluate(
  supabase: DbClient,
  userId: string,
  session: { level: LevelId; isReplay: boolean; abandoned: boolean },
) {
  const state = await db.ensureLevelState(supabase, userId, session.level);

  if (session.isReplay) return null; // replays don't distort progression stats

  if (!session.abandoned) {
    await db.incrementSessionsAtLevel(supabase, userId);
  }
  if (state.manual_override) return null; // suppressed until the user clears it

  const alreadyPending = await db.getPendingEvent(supabase, userId);
  if (alreadyPending) return alreadyPending; // one recommendation at a time

  const levelSessions = await db.getSessionIdsAtLevel(supabase, userId, session.level);
  const sessionIds = levelSessions.map((s) => s.id);
  const distinctScenarios = new Set(levelSessions.map((s) => s.scenario_id)).size;
  const sessionsAtLevel = state.sessions_at_level + (session.abandoned ? 0 : 1);

  const attempts = await db.getRecentAttempts(supabase, sessionIds, ROLLING_WINDOW);

  const levels = await db.getLevelsOrdered(supabase);
  const idx = levels.findIndex((l) => l.id === session.level);
  const nextLevel = levels[idx + 1];
  const prevLevel = idx > 0 ? levels[idx - 1] : undefined;

  const recentSessions = await db.getRecentSessions(supabase, userId);
  let consecutiveAbandoned = 0;
  for (const s of recentSessions) {
    if (s.is_replay) continue;
    if (!s.abandoned) break;
    consecutiveAbandoned++;
  }

  const recommendation = computeRecommendation({
    attempts,
    sessionsAtLevel,
    distinctScenarios,
    hasNextLevel: !!nextLevel,
    hasPrevLevel: !!prevLevel,
    consecutiveAbandoned,
    abandoned: session.abandoned,
  });

  if (!recommendation) return null;

  if (recommendation.type === "promote") {
    const dismissed = await db.getLastDismissedEvent(supabase, userId);
    if (dismissed) {
      const since = await db.countAttemptsSince(supabase, sessionIds, dismissed.created_at);
      if (since < DISMISS_COOLDOWN_ATTEMPTS) return null;
    }
    return db.insertEvent(supabase, {
      userId,
      fromLevel: session.level,
      toLevel: nextLevel!.id,
      reason: recommendation.reason,
    });
  }

  return db.insertEvent(supabase, {
    userId,
    fromLevel: session.level,
    toLevel: prevLevel!.id,
    reason: recommendation.reason,
  });
}

/** The learner accepted the suggestion. */
export async function accept(supabase: DbClient, userId: string, eventId: string) {
  const event = await db.getEventById(supabase, eventId);
  await db.setEventAccepted(supabase, eventId, true);
  await db.setLevelState(supabase, userId, { level: event.to_level, sessionsAtLevel: 0 });
}

/** The learner dismissed it — starts the 20-attempt cooldown before it can re-fire. */
export async function dismiss(supabase: DbClient, eventId: string) {
  await db.setEventAccepted(supabase, eventId, false);
}

export async function override(supabase: DbClient, userId: string, level: LevelId) {
  await db.setLevelState(supabase, userId, {
    level,
    sessionsAtLevel: 0,
    manualOverride: true,
  });
  const event = await db.insertEvent(supabase, {
    userId,
    fromLevel: null,
    toLevel: level,
    reason: "manual override",
  });
  await db.setEventAccepted(supabase, event.id, true);
}

export async function clearOverride(supabase: DbClient, userId: string) {
  const state = await db.getLevelState(supabase, userId);
  if (!state) return;
  await db.setLevelState(supabase, userId, {
    level: state.level,
    sessionsAtLevel: state.sessions_at_level,
    manualOverride: false,
  });
}
