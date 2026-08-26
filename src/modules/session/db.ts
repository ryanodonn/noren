import "server-only";
import type { DbClient } from "@/lib/supabase/types";
import type { LevelId, Verdict } from "@/lib/types";

export async function insertSession(
  db: DbClient,
  params: {
    userId: string;
    mode: "conversation" | "listening";
    scenarioId: string;
    variantId: string;
    level: LevelId;
    dialogueId: string;
    isReplay: boolean;
  },
) {
  const { data, error } = await db
    .from("sessions")
    .insert({
      user_id: params.userId,
      mode: params.mode,
      scenario_id: params.scenarioId,
      variant_id: params.variantId,
      level: params.level,
      dialogue_id: params.dialogueId,
      is_replay: params.isReplay,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getSession(db: DbClient, sessionId: string) {
  const { data, error } = await db
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  return data;
}

export async function insertAttempt(
  db: DbClient,
  params: {
    sessionId: string;
    lineId: string;
    seq: number;
    userAnswer: string | null;
    verdict: Verdict | null;
    hintsUsed: number;
    note: string | null;
    latencyMs: number | null;
  },
) {
  const { error } = await db.from("attempts").insert({
    session_id: params.sessionId,
    line_id: params.lineId,
    seq: params.seq,
    user_answer: params.userAnswer,
    verdict: params.verdict,
    hints_used: params.hintsUsed,
    note: params.note,
    latency_ms: params.latencyMs,
  });
  if (error) throw error;
}

export async function insertLookup(
  db: DbClient,
  params: {
    sessionId: string;
    userId: string;
    tokenJa: string;
    kana?: string | null;
    romaji?: string | null;
    en?: string | null;
  },
) {
  const { error } = await db.from("lookups").insert({
    session_id: params.sessionId,
    user_id: params.userId,
    token_ja: params.tokenJa,
    kana: params.kana ?? null,
    romaji: params.romaji ?? null,
    en: params.en ?? null,
  });
  if (error) throw error;
}

export async function completeSession(
  db: DbClient,
  sessionId: string,
  abandoned: boolean,
) {
  const { error } = await db
    .from("sessions")
    .update({ completed_at: new Date().toISOString(), abandoned })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function getSessionSummary(db: DbClient, sessionId: string) {
  const { data, error } = await db
    .from("attempts")
    .select("verdict, hints_used, note, line_id")
    .eq("session_id", sessionId)
    .order("seq");
  if (error) throw error;

  const summary = { got_it: 0, close: 0, missed: 0, total_hints: 0 };
  const missedLineIds: { lineId: string; note: string | null }[] = [];

  for (const a of data) {
    if (a.verdict === "got_it") summary.got_it++;
    else if (a.verdict === "close") {
      summary.close++;
      missedLineIds.push({ lineId: a.line_id, note: a.note });
    } else if (a.verdict === "missed") {
      summary.missed++;
      missedLineIds.push({ lineId: a.line_id, note: a.note });
    }
    summary.total_hints += a.hints_used;
  }

  let missedLines: { en: string; note: string | null }[] = [];
  if (missedLineIds.length > 0) {
    const { data: lines, error: linesError } = await db
      .from("generated_lines")
      .select("id, en")
      .in("id", missedLineIds.map((m) => m.lineId));
    if (linesError) throw linesError;
    const enById = new Map(lines.map((l) => [l.id, l.en]));
    missedLines = missedLineIds.map((m) => ({
      en: enById.get(m.lineId) ?? "",
      note: m.note,
    }));
  }

  return { summary, missedLines };
}
