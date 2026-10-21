"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";
import * as Identity from "@/modules/identity";

/** Why the start failed, for the client to phrase. `undefined` means it
 *  succeeded and the redirect below is taking over. */
export type StartSessionResult = {
  ok: false;
  reason: Session.StartSessionFailureReason | "unknown";
};

export async function startSessionAction(
  params: { scenarioId: string; level: string },
): Promise<StartSessionResult | undefined> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let sessionId: string;
  try {
    const { session } = await Session.startSession(supabase, {
      userId: user.id,
      scenarioId: params.scenarioId,
      level: params.level,
      mode: "conversation",
    });
    sessionId = session.id;
  } catch (err) {
    if (err instanceof Session.StartSessionError) return { ok: false, reason: err.reason };
    console.error("[pick] startSession failed", err);
    return { ok: false, reason: "unknown" };
  }

  // Outside the try on purpose: redirect() signals navigation by throwing
  // NEXT_REDIRECT, and catching it here would swallow the navigation.
  redirect(`/sessions/${sessionId}`);
}

export async function saveVoiceAssignments(params: { voiceA: string | null; voiceB: string | null }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await Identity.updatePreferences(supabase, user.id, {
    voiceAssignments: {
      ...(params.voiceA ? { a: params.voiceA } : {}),
      ...(params.voiceB ? { b: params.voiceB } : {}),
    },
  });
}
