"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";

export async function startSessionAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const scenarioId = String(formData.get("scenarioId"));
  const level = String(formData.get("level"));

  const { session } = await Session.startSession(supabase, {
    userId: user.id,
    scenarioId,
    level,
    mode: "conversation",
  });

  redirect(`/sessions/${session.id}`);
}
