import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId, Verdict } from "@/lib/types";
import * as db from "./db";
import { gradeAnswer } from "./grading";
import { buildHint } from "./hints";
import { buildDebrief } from "./debrief";

type ScenarioForContent = { id: string };
type VariantForContent = { id: string };

/**
 * Serves a randomly-picked, pre-authored dialogue for this
 * scenario/variant/level (services.md §2.3) — no live generation. If nothing's
 * been authored yet for this key, this throws; author content for it first
 * (see scripts/seed-content or ask for more to be written).
 */
export async function getDialogue(
  supabase: DbClient,
  scenario: ScenarioForContent,
  variant: VariantForContent,
  level: LevelId,
) {
  const pooled = await db.findPooledDialogue(supabase, {
    scenarioId: scenario.id,
    variantId: variant.id,
    level,
  });
  if (!pooled) {
    throw new Error(
      `No dialogue content authored yet for scenario ${scenario.id}, variant ${variant.id}, level ${level}.`,
    );
  }
  return db.fetchDialogueWithLines(supabase, pooled.id);
}

export async function getDialogueById(supabase: DbClient, dialogueId: string) {
  return db.fetchDialogueWithLines(supabase, dialogueId);
}

export async function getLine(supabase: DbClient, lineId: string) {
  return db.fetchLine(supabase, lineId);
}

export async function grade(
  supabase: DbClient,
  params: { lineId: string; userAnswer: string },
): Promise<{ verdict: Verdict; note: string | null }> {
  const line = await db.fetchLine(supabase, params.lineId);
  return gradeAnswer({
    userAnswer: params.userAnswer,
    acceptableJa: (line.acceptable_ja as string[]) ?? [],
    acceptableRomaji: (line.acceptable_romaji as string[]) ?? [],
  });
}

export async function getHint(
  supabase: DbClient,
  params: { lineId: string; hintsUsedSoFar: number },
): Promise<{ hint: string }> {
  const line = await db.fetchLine(supabase, params.lineId);
  return { hint: buildHint(line, params.hintsUsedSoFar) };
}

export async function getDebrief(params: {
  scenarioNameEn: string;
  summary: { got_it: number; close: number; missed: number; total_hints: number };
  missedLines: { en: string; note: string | null }[];
}): Promise<{ debrief: string }> {
  return { debrief: buildDebrief(params) };
}
