"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import * as Progression from "@/modules/progression";

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
