import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import * as Identity from "@/modules/identity";
import { acceptRecommendation, dismissRecommendation } from "./actions";
import { PickClient } from "./PickClient";

export default async function PickPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [levels, scenarios, { levelState, recommendation }, me] = await Promise.all([
    Catalog.listLevels(supabase),
    Catalog.listScenarios(supabase, user.id),
    Progression.getStatus(supabase, user.id),
    Identity.getMe(supabase),
  ]);

  const defaultLevelId = levelState?.level ?? me?.profile.default_level ?? levels[0]?.id;

  let recommendationText: string | null = null;
  if (recommendation) {
    const currentSortOrder = levels.find((l) => l.id === levelState?.level)?.sort_order ?? 0;
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

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

        {recommendation && recommendationText && (
          <div className="mb-8 px-4 py-4 border-l-3 border-noren-amber bg-noren-panel">
            <p className="mb-3 text-sm">{recommendationText}</p>
            <div className="flex gap-2">
              <form action={acceptRecommendation}>
                <input type="hidden" name="eventId" value={recommendation.id} />
                <button className="px-3 py-1.5 text-xs uppercase tracking-[0.15em] bg-noren-amber text-noren-bg">
                  Accept
                </button>
              </form>
              <form action={dismissRecommendation}>
                <input type="hidden" name="eventId" value={recommendation.id} />
                <button className="px-3 py-1.5 text-xs uppercase tracking-[0.15em] border border-noren-edge text-noren-dim">
                  Not now
                </button>
              </form>
            </div>
          </div>
        )}

        <PickClient
          levels={levels}
          scenarios={scenarios}
          defaultLevelId={defaultLevelId}
          savedVoiceA={savedVoices.a ?? null}
          savedVoiceB={savedVoices.b ?? null}
        />
      </div>
    </main>
  );
}
