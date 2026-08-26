import "server-only";
import {
  fsrs,
  createEmptyCard,
  Rating,
  type Card,
  type Grade,
} from "ts-fsrs";

const scheduler = fsrs();

const RATING_MAP: Record<"again" | "hard" | "good" | "easy", Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function cardFromState(state: unknown): Card {
  if (!state) return createEmptyCard(new Date());
  const s = state as Card;
  return {
    ...s,
    due: new Date(s.due),
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  };
}

export function scheduleReview(
  currentState: unknown,
  rating: "again" | "hard" | "good" | "easy",
  now = new Date(),
) {
  const card = cardFromState(currentState);
  const { card: nextCard, log } = scheduler.next(card, now, RATING_MAP[rating]);
  return { nextCard, log };
}

/** Dates aren't valid JSON — stringify before writing to the jsonb column. */
export function serializeCard(card: Card) {
  return {
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}
