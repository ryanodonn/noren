import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";
import { DrillClient } from "./DrillClient";

export default async function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { dialogue, scenario } = await Session.getSession(supabase, id);

  return (
    <main className="mx-auto max-w-xl flex-1 px-6 py-10">
      <h1 className="mb-4 text-lg font-semibold">
        {scenario.name_ja} <span className="text-base text-neutral-400">{scenario.name_en}</span>
      </h1>
      <DrillClient
        sessionId={id}
        speakerA={scenario.speaker_a}
        speakerB={scenario.speaker_b}
        lines={dialogue.generated_lines.map((l) => ({
          id: l.id,
          seq: l.seq,
          speaker: l.speaker as "a" | "b",
          ja: l.ja,
          kana: l.kana,
          romaji: l.romaji,
          en: l.en,
          tokens: (l.tokens as { ja: string; kana?: string; romaji?: string; en?: string }[]) ?? [],
        }))}
      />
    </main>
  );
}
