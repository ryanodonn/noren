import "server-only";
import type { DbClient } from "@/lib/supabase/types";

export async function findCard(db: DbClient, userId: string, tokenJa: string) {
  const { data, error } = await db
    .from("vocab_cards")
    .select("*")
    .eq("user_id", userId)
    .eq("token_ja", tokenJa)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCard(db: DbClient, cardId: string) {
  const { data, error } = await db
    .from("vocab_cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (error) throw error;
  return data;
}

export async function countRecentlyCreated(db: DbClient, userId: string) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("vocab_cards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("first_seen", since);
  if (error) throw error;
  return count ?? 0;
}

export async function countLookupOccurrences(
  db: DbClient,
  userId: string,
  tokenJa: string,
) {
  const { count, error } = await db
    .from("lookups")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("token_ja", tokenJa);
  if (error) throw error;
  return count ?? 0;
}

export async function insertCard(
  db: DbClient,
  params: {
    userId: string;
    tokenJa: string;
    kana?: string | null;
    romaji?: string | null;
    en?: string | null;
    source: "missed" | "lookup" | "manual";
    contextSentenceJa?: string | null;
  },
) {
  const { error } = await db.from("vocab_cards").insert({
    user_id: params.userId,
    token_ja: params.tokenJa,
    kana: params.kana ?? null,
    romaji: params.romaji ?? null,
    en: params.en ?? null,
    source: params.source,
    times_missed: params.source === "missed" ? 1 : 0,
    times_looked_up: params.source === "lookup" ? 1 : 0,
    context_sentence_ja: params.contextSentenceJa ?? null,
  });
  if (error) throw error;
}

export async function incrementMissed(
  db: DbClient,
  cardId: string,
  currentTimesMissed: number,
  contextSentenceJa: string | null,
) {
  const { error } = await db
    .from("vocab_cards")
    .update({
      times_missed: currentTimesMissed + 1,
      context_sentence_ja: contextSentenceJa,
    })
    .eq("id", cardId);
  if (error) throw error;
}

export async function incrementLookedUp(
  db: DbClient,
  cardId: string,
  currentTimesLookedUp: number,
) {
  const { error } = await db
    .from("vocab_cards")
    .update({ times_looked_up: currentTimesLookedUp + 1 })
    .eq("id", cardId);
  if (error) throw error;
}

export async function fetchDue(db: DbClient, userId: string, limit: number) {
  const { data, error } = await db
    .from("vocab_cards")
    .select("*")
    .eq("user_id", userId)
    .eq("suspended", false)
    .lte("due_at", new Date().toISOString())
    .order("due_at")
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function applyReview(
  db: DbClient,
  cardId: string,
  params: {
    stability: number;
    difficulty: number;
    dueAt: string;
    lastReviewed: string;
    fsrsState: unknown;
  },
) {
  const { error } = await db
    .from("vocab_cards")
    .update({
      stability: params.stability,
      difficulty: params.difficulty,
      due_at: params.dueAt,
      last_reviewed: params.lastReviewed,
      fsrs_state: params.fsrsState as never,
    })
    .eq("id", cardId);
  if (error) throw error;
}

export async function insertReview(
  db: DbClient,
  params: {
    cardId: string;
    rating: "again" | "hard" | "good" | "easy";
    elapsedDays: number;
    scheduledDays: number;
  },
) {
  const { error } = await db.from("vocab_reviews").insert({
    card_id: params.cardId,
    rating: params.rating,
    elapsed_days: params.elapsedDays,
    scheduled_days: params.scheduledDays,
  });
  if (error) throw error;
}

export async function suspendCard(db: DbClient, cardId: string) {
  const { error } = await db
    .from("vocab_cards")
    .update({ suspended: true })
    .eq("id", cardId);
  if (error) throw error;
}
