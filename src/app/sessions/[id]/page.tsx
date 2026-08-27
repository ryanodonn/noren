import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";
import * as Catalog from "@/modules/catalog";
import * as Identity from "@/modules/identity";
import { DrillClient } from "./DrillClient";

export default async function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { session, dialogue, scenario } = await Session.getSession(supabase, id);
  const [level, me] = await Promise.all([
    Catalog.getLevel(supabase, session.level),
    Identity.getMe(supabase),
  ]);

  const savedVoices = (me?.profile.voice_assignments as { a?: string; b?: string } | null) ?? {};

  return (
    <DrillClient
      sessionId={id}
      scenarioNameJa={scenario.name_ja}
      lineLabel={scenario.line_label}
      levelLabelEn={level.label_en}
      levelRate={level.rate ?? 1}
      speakerA={scenario.speaker_a}
      speakerB={scenario.speaker_b}
      setting={dialogue.setting}
      voiceA={savedVoices.a ?? null}
      voiceB={savedVoices.b ?? null}
      lines={dialogue.generated_lines.map((l) => ({
        id: l.id,
        seq: l.seq,
        speaker: l.speaker as "a" | "b",
        ja: l.ja,
        romaji: l.romaji,
        en: l.en,
        gist: l.gist,
        key_ja: l.key_ja,
        key_romaji: l.key_romaji,
        key_en: l.key_en,
        kana: l.kana,
        tokens:
          (l.tokens as { ja: string; kana?: string; romaji?: string; en?: string }[]) ?? [],
      }))}
    />
  );
}
