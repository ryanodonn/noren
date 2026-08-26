import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Session from "@/modules/session";
import * as ContentGeneration from "@/modules/content-generation";
import * as Progression from "@/modules/progression";
import * as Catalog from "@/modules/catalog";
import { acceptRecommendation, dismissRecommendation } from "@/app/actions";

export default async function DebriefPage({ params }: PageProps<"/sessions/[id]/debrief">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ scenario }, { summary, missedLines }, { levelState, recommendation }, levels] =
    await Promise.all([
      Session.getSession(supabase, id),
      Session.getSummary(supabase, id),
      Progression.getStatus(supabase, user.id),
      Catalog.listLevels(supabase),
    ]);

  const { debrief } = await ContentGeneration.getDebrief({
    scenarioNameEn: scenario.name_en,
    summary,
    missedLines,
  });

  let recommendationText: string | null = null;
  if (recommendation) {
    const currentSortOrder = levels.find((l) => l.id === levelState?.level)?.sort_order ?? 0;
    const toLevel = levels.find((l) => l.id === recommendation.to_level);
    const isPromotion = (toLevel?.sort_order ?? 0) > currentSortOrder;
    recommendationText = isPromotion
      ? `You're ready for ${toLevel?.label_ja} — ${recommendation.reason}.`
      : `Want to drop back to ${toLevel?.label_ja} for a bit? (${recommendation.reason})`;
  }

  return (
    <main className="mx-auto max-w-xl flex-1 px-6 py-10">
      <h1 className="mb-4 text-xl font-semibold">Debrief</h1>

      <div className="mb-6 grid grid-cols-4 gap-2 text-center text-sm">
        <div className="rounded border p-3">
          <p className="text-lg font-semibold text-green-700">{summary.got_it}</p>
          <p className="text-neutral-500">Got it</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-lg font-semibold text-amber-700">{summary.close}</p>
          <p className="text-neutral-500">Close</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-lg font-semibold text-red-700">{summary.missed}</p>
          <p className="text-neutral-500">Missed</p>
        </div>
        <div className="rounded border p-3">
          <p className="text-lg font-semibold">{summary.total_hints}</p>
          <p className="text-neutral-500">Hints</p>
        </div>
      </div>

      <p className="mb-6 rounded border bg-neutral-50 p-4 text-sm text-neutral-700">{debrief}</p>

      {recommendation && recommendationText && (
        <div className="mb-6 rounded border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="mb-3">{recommendationText}</p>
          <div className="flex gap-2">
            <form action={acceptRecommendation}>
              <input type="hidden" name="eventId" value={recommendation.id} />
              <button className="rounded bg-neutral-900 px-3 py-1 text-white">Accept</button>
            </form>
            <form action={dismissRecommendation}>
              <input type="hidden" name="eventId" value={recommendation.id} />
              <button className="rounded border px-3 py-1">Not now</button>
            </form>
          </div>
        </div>
      )}

      <Link
        href="/"
        className="inline-block rounded bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
      >
        Back to scenarios
      </Link>
    </main>
  );
}
