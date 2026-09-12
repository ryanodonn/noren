import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import * as Identity from "@/modules/identity";
import { PickClient } from "./PickClient";

export default async function PickPage({ searchParams }: PageProps<"/pick">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [levels, scenarios, { levelState }, me, params] = await Promise.all([
    Catalog.listLevels(supabase),
    Catalog.listScenarios(supabase, user.id),
    Progression.getStatus(supabase, user.id),
    Identity.getMe(supabase),
    searchParams,
  ]);

  const defaultLevelId = levelState?.level ?? me?.profile.default_level ?? levels[0]?.id;
  const requestedScenario = typeof params.scenario === "string" ? params.scenario : null;
  const defaultScenarioId =
    scenarios.find((s) => s.slug === requestedScenario)?.id ?? scenarios[0]?.id ?? "";
  const savedVoices = (me?.profile.voice_assignments as { a?: string; b?: string } | null) ?? {};

  return (
    <main className="board min-h-screen p-5 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="border-b pb-4 mb-8 border-noren-edge">
          <div className="text-xs tracking-[0.3em] mb-1 text-noren-amber">ききとり</div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-wide uppercase">Listening</h1>
          <p className="text-sm mt-2 text-noren-dim">
            You overhear a conversation. After each line, say what it meant in English. Nothing is
            written down until you&apos;ve answered.
          </p>
        </div>

        <PickClient
          levels={levels}
          scenarios={scenarios}
          defaultLevelId={defaultLevelId}
          defaultScenarioId={defaultScenarioId}
          savedVoiceA={savedVoices.a ?? null}
          savedVoiceB={savedVoices.b ?? null}
        />
      </div>
    </main>
  );
}
