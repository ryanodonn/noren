"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as Progression from "@/modules/progression";
import * as Session from "@/modules/session";
import * as Identity from "@/modules/identity";

export async function acceptRecommendation(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await Progression.accept(supabase, user.id, String(formData.get("eventId")));
  revalidatePath("/");
}

export async function dismissRecommendation(formData: FormData) {
  const supabase = await createClient();
  await Progression.dismiss(supabase, String(formData.get("eventId")));
  revalidatePath("/");
}

export async function startSessionAction(params: { scenarioId: string; level: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { session } = await Session.startSession(supabase, {
    userId: user.id,
    scenarioId: params.scenarioId,
    level: params.level,
    mode: "conversation",
  });

  redirect(`/sessions/${session.id}`);
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
