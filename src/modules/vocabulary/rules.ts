// Pure card-creation decision rules (services.md §2.7), kept free of DB/IO
// so they're directly unit-testable — mirrors the Progression module's
// algorithm.ts split for the same reason.
import { isStopword } from "./stoplist";

export const NEW_CARDS_PER_DAY = 10;
export const MIN_LOOKUP_OCCURRENCES = 2;

export function shouldHarvestAttempt(verdict: string | null): boolean {
  return verdict === "missed" || verdict === "close";
}

/** missed-sourced tokens create a card on first occurrence. */
export function shouldCreateMissedCard(tokenJa: string, alreadyExists: boolean): boolean {
  if (alreadyExists) return false;
  return !isStopword(tokenJa);
}

/** lookup-sourced tokens need >=2 occurrences — one tap is curiosity, two is a gap. */
export function shouldCreateLookupCard(
  tokenJa: string,
  alreadyExists: boolean,
  occurrences: number,
): boolean {
  if (alreadyExists) return false;
  if (isStopword(tokenJa)) return false;
  return occurrences >= MIN_LOOKUP_OCCURRENCES;
}

export function isUnderDailyCap(recentlyCreatedCount: number): boolean {
  return recentlyCreatedCount < NEW_CARDS_PER_DAY;
}
