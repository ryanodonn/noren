import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId } from "@/lib/types";

export async function getLevelsOrdered(db: DbClient) {
  const { data, error } = await db
    .from("levels")
    .select("id, sort_order")
    .order("sort_order");
  if (error) throw error;
  return data;
}

export async function getLevelState(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("level_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureLevelState(
  db: DbClient,
  userId: string,
  defaultLevel: LevelId,
) {
  const existing = await getLevelState(db, userId);
  if (existing) return existing;
  const { data, error } = await db
    .from("level_state")
    .insert({ user_id: userId, level: defaultLevel })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setLevelState(
  db: DbClient,
  userId: string,
  params: {
    level: LevelId;
    sessionsAtLevel: number;
    manualOverride?: boolean;
  },
) {
  const { error } = await db
    .from("level_state")
    .update({
      level: params.level,
      since: new Date().toISOString(),
      sessions_at_level: params.sessionsAtLevel,
      ...(params.manualOverride !== undefined
        ? { manual_override: params.manualOverride }
        : {}),
    })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function incrementSessionsAtLevel(db: DbClient, userId: string) {
  const state = await getLevelState(db, userId);
  if (!state) return;
  const { error } = await db
    .from("level_state")
    .update({ sessions_at_level: state.sessions_at_level + 1 })
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getPendingEvent(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("level_events")
    .select("*")
    .eq("user_id", userId)
    .is("accepted", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLastDismissedEvent(db: DbClient, userId: string) {
  const { data, error } = await db
    .from("level_events")
    .select("*")
    .eq("user_id", userId)
    .eq("accepted", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertEvent(
  db: DbClient,
  params: {
    userId: string;
    fromLevel: LevelId | null;
    toLevel: LevelId;
    reason: string;
  },
) {
  const { data, error } = await db
    .from("level_events")
    .insert({
      user_id: params.userId,
      from_level: params.fromLevel,
      to_level: params.toLevel,
      reason: params.reason,
      accepted: null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getEventById(db: DbClient, eventId: string) {
  const { data, error } = await db
    .from("level_events")
    .select("*")
    .eq("id", eventId)
    .single();
  if (error) throw error;
  return data;
}

export async function setEventAccepted(
  db: DbClient,
  eventId: string,
  accepted: boolean,
) {
  const { error } = await db
    .from("level_events")
    .update({ accepted })
    .eq("id", eventId);
  if (error) throw error;
}

/** Non-replay, completed sessions for this user at this level. */
export async function getSessionIdsAtLevel(
  db: DbClient,
  userId: string,
  level: LevelId,
) {
  const { data, error } = await db
    .from("sessions")
    .select("id, scenario_id")
    .eq("user_id", userId)
    .eq("level", level)
    .eq("is_replay", false)
    .not("completed_at", "is", null);
  if (error) throw error;
  return data;
}

export async function getRecentAttempts(
  db: DbClient,
  sessionIds: string[],
  limit: number,
) {
  if (sessionIds.length === 0) return [];
  const { data, error } = await db
    .from("attempts")
    .select("verdict, hints_used, answered_at")
    .in("session_id", sessionIds)
    .order("answered_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function countAttemptsSince(
  db: DbClient,
  sessionIds: string[],
  sinceIso: string,
) {
  if (sessionIds.length === 0) return 0;
  const { count, error } = await db
    .from("attempts")
    .select("id", { count: "exact", head: true })
    .in("session_id", sessionIds)
    .gt("answered_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

/** Most recent sessions (any level), to check the consecutive-abandoned streak. */
export async function getRecentSessions(db: DbClient, userId: string, limit = 10) {
  const { data, error } = await db
    .from("sessions")
    .select("abandoned, is_replay, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
