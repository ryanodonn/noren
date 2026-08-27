"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as ContentGeneration from "@/modules/content-generation";
import * as Session from "@/modules/session";

export async function submitAttempt(params: {
  sessionId: string;
  lineId: string;
  seq: number;
  userAnswer: string;
  hintsUsed: number;
  latencyMs: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { verdict, note } = await ContentGeneration.grade(supabase, {
    lineId: params.lineId,
    userAnswer: params.userAnswer,
  });

  await Session.recordAttempt(supabase, {
    userId: user.id,
    sessionId: params.sessionId,
    lineId: params.lineId,
    seq: params.seq,
    userAnswer: params.userAnswer,
    verdict,
    hintsUsed: params.hintsUsed,
    note,
    latencyMs: params.latencyMs,
  });

  return { verdict, note };
}

export async function skipAttempt(params: {
  sessionId: string;
  lineId: string;
  seq: number;
  hintsUsed: number;
  latencyMs: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await Session.recordAttempt(supabase, {
    userId: user.id,
    sessionId: params.sessionId,
    lineId: params.lineId,
    seq: params.seq,
    userAnswer: null,
    verdict: "missed",
    hintsUsed: params.hintsUsed,
    note: "Skipped.",
    latencyMs: params.latencyMs,
  });

  return { verdict: "missed" as const, note: "Skipped." };
}

export async function lookupToken(params: {
  sessionId: string;
  ja: string;
  kana?: string;
  romaji?: string;
  en?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await Session.recordLookup(supabase, {
    userId: user.id,
    sessionId: params.sessionId,
    tokenJa: params.ja,
    kana: params.kana,
    romaji: params.romaji,
    en: params.en,
  });
}

export async function finishSession(params: { sessionId: string; abandoned?: boolean }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  await Session.completeSession(supabase, {
    userId: user.id,
    sessionId: params.sessionId,
    abandoned: params.abandoned,
  });

  redirect(`/sessions/${params.sessionId}/debrief`);
}
