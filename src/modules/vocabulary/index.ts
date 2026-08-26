import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { Token, Verdict } from "@/lib/types";
import * as db from "./db";
import { scheduleReview, serializeCard } from "./fsrs";
import {
  shouldHarvestAttempt,
  shouldCreateMissedCard,
  shouldCreateLookupCard,
  isUnderDailyCap,
} from "./rules";

/**
 * Missed/close attempts harvest every non-stopword token from the line.
 * `missed`-sourced cards are created on first occurrence (demonstrated
 * failure is strong evidence) — services.md §2.7.
 */
export async function harvestFromAttempt(
  supabase: DbClient,
  params: {
    userId: string;
    verdict: Verdict | null;
    tokens: Token[];
    contextSentenceJa: string;
  },
) {
  if (!shouldHarvestAttempt(params.verdict)) return;

  for (const token of params.tokens) {
    const existing = await db.findCard(supabase, params.userId, token.ja);

    if (existing) {
      await db.incrementMissed(
        supabase,
        existing.id,
        existing.times_missed,
        params.contextSentenceJa,
      );
      continue;
    }

    if (!shouldCreateMissedCard(token.ja, false)) continue;
    if (!isUnderDailyCap(await db.countRecentlyCreated(supabase, params.userId))) {
      continue; // queue stays reviewable; this miss will resurface next time
    }

    await db.insertCard(supabase, {
      userId: params.userId,
      tokenJa: token.ja,
      kana: token.kana,
      romaji: token.romaji,
      en: token.en,
      source: "missed",
      contextSentenceJa: params.contextSentenceJa,
    });
  }
}

/**
 * A tapped word is weaker evidence than a missed line: require >=2 lookup
 * occurrences of the same token before it becomes a card — services.md §2.7.
 * Assumes the lookup itself has already been recorded in `lookups` by
 * Session & Attempt before this is called, so the occurrence count includes it.
 */
export async function harvestFromLookup(
  supabase: DbClient,
  params: {
    userId: string;
    tokenJa: string;
    kana?: string | null;
    romaji?: string | null;
    en?: string | null;
  },
) {
  const existing = await db.findCard(supabase, params.userId, params.tokenJa);
  if (existing) {
    await db.incrementLookedUp(supabase, existing.id, existing.times_looked_up);
    return;
  }

  const occurrences = await db.countLookupOccurrences(
    supabase,
    params.userId,
    params.tokenJa,
  );
  if (!shouldCreateLookupCard(params.tokenJa, false, occurrences)) return;

  if (!isUnderDailyCap(await db.countRecentlyCreated(supabase, params.userId))) {
    return;
  }

  await db.insertCard(supabase, {
    userId: params.userId,
    tokenJa: params.tokenJa,
    kana: params.kana,
    romaji: params.romaji,
    en: params.en,
    source: "lookup",
  });
}

export async function getDue(supabase: DbClient, userId: string, limit = 20) {
  return db.fetchDue(supabase, userId, limit);
}

export async function review(
  supabase: DbClient,
  cardId: string,
  rating: "again" | "hard" | "good" | "easy",
) {
  const card = await db.fetchCard(supabase, cardId);
  const { nextCard, log } = scheduleReview(card.fsrs_state, rating);

  await db.applyReview(supabase, cardId, {
    stability: nextCard.stability,
    difficulty: nextCard.difficulty,
    dueAt: nextCard.due.toISOString(),
    lastReviewed: new Date().toISOString(),
    fsrsState: serializeCard(nextCard),
  });

  await db.insertReview(supabase, {
    cardId,
    rating,
    elapsedDays: log.elapsed_days,
    scheduledDays: log.scheduled_days,
  });
}

export async function suspend(supabase: DbClient, cardId: string) {
  await db.suspendCard(supabase, cardId);
}
