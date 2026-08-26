import "server-only";
import type { DbClient } from "@/lib/supabase/types";

export async function getMe(supabase: DbClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();
  if (error) throw error;

  return { user, profile };
}

export async function updatePreferences(
  supabase: DbClient,
  userId: string,
  params: {
    defaultLevel?: string;
    scriptPreference?: "kana_romaji_en" | "kana_en" | "romaji_en";
    voiceAssignments?: Record<string, string>;
    ttsVendor?: string;
  },
) {
  const { error } = await supabase
    .from("profiles")
    .update({
      ...(params.defaultLevel !== undefined && { default_level: params.defaultLevel }),
      ...(params.scriptPreference !== undefined && {
        script_preference: params.scriptPreference,
      }),
      ...(params.voiceAssignments !== undefined && {
        voice_assignments: params.voiceAssignments,
      }),
      ...(params.ttsVendor !== undefined && { tts_vendor: params.ttsVendor }),
    })
    .eq("user_id", userId);
  if (error) throw error;
}
