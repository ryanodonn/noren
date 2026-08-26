import { describe, it, expect } from "vitest";
import {
  shouldHarvestAttempt,
  shouldCreateMissedCard,
  shouldCreateLookupCard,
  isUnderDailyCap,
  NEW_CARDS_PER_DAY,
  MIN_LOOKUP_OCCURRENCES,
} from "./rules";

describe("shouldHarvestAttempt", () => {
  it("harvests on missed and close verdicts", () => {
    expect(shouldHarvestAttempt("missed")).toBe(true);
    expect(shouldHarvestAttempt("close")).toBe(true);
  });

  it("does not harvest a cold-correct got_it", () => {
    expect(shouldHarvestAttempt("got_it")).toBe(false);
  });

  it("does not harvest a null verdict (failed grading)", () => {
    expect(shouldHarvestAttempt(null)).toBe(false);
  });
});

describe("shouldCreateMissedCard", () => {
  it("creates a card on first occurrence — missed is strong evidence", () => {
    expect(shouldCreateMissedCard("袋", false)).toBe(true);
  });

  it("does not create a duplicate for a token that already has a card", () => {
    expect(shouldCreateMissedCard("袋", true)).toBe(false);
  });

  it("excludes stopwords even on a genuine miss", () => {
    expect(shouldCreateMissedCard("は", false)).toBe(false);
    expect(shouldCreateMissedCard("です", false)).toBe(false);
  });
});

describe("shouldCreateLookupCard", () => {
  it("does not create a card on the first lookup — one tap is curiosity", () => {
    expect(shouldCreateLookupCard("温める", false, 1)).toBe(false);
  });

  it(`creates a card at the ${MIN_LOOKUP_OCCURRENCES}nd occurrence — two is a gap`, () => {
    expect(shouldCreateLookupCard("温める", false, MIN_LOOKUP_OCCURRENCES)).toBe(true);
  });

  it("does not create a duplicate for an existing card", () => {
    expect(shouldCreateLookupCard("温める", true, 5)).toBe(false);
  });

  it("excludes stopwords regardless of occurrence count", () => {
    expect(shouldCreateLookupCard("の", false, 10)).toBe(false);
  });
});

describe("isUnderDailyCap", () => {
  it(`allows creation below the ${NEW_CARDS_PER_DAY}/day cap`, () => {
    expect(isUnderDailyCap(NEW_CARDS_PER_DAY - 1)).toBe(true);
  });

  it("blocks creation once the cap is reached", () => {
    expect(isUnderDailyCap(NEW_CARDS_PER_DAY)).toBe(false);
    expect(isUnderDailyCap(NEW_CARDS_PER_DAY + 5)).toBe(false);
  });
});
