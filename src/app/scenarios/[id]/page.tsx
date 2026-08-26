import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Catalog from "@/modules/catalog";
import * as Progression from "@/modules/progression";
import { startSessionAction } from "./actions";

export default async function ScenarioPage({ params }: PageProps<"/scenarios/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [scenario, { levelState }] = await Promise.all([
    Catalog.getBriefing(supabase, id),
    Progression.getStatus(supabase, user.id),
  ]);
  const level = levelState?.level ?? "kodomo";

  return (
    <main className="mx-auto max-w-xl flex-1 px-6 py-10">
      <h1 className="text-xl font-semibold">
        {scenario.name_ja} <span className="text-base text-neutral-400">{scenario.name_en}</span>
      </h1>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-neutral-700">Where</dt>
          <dd className="text-neutral-600">{scenario.where_text}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-700">Who</dt>
          <dd className="text-neutral-600">{scenario.who_text}</dd>
        </div>
        <div>
          <dt className="font-medium text-neutral-700">Listen for</dt>
          <dd className="text-neutral-600">{scenario.goal_text}</dd>
        </div>
      </dl>

      {scenario.seed_phrases.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-neutral-700">Useful phrases</h2>
          <ul className="space-y-1 text-sm text-neutral-600">
            {scenario.seed_phrases.map((p) => (
              <li key={p.id}>
                {p.ja} <span className="text-neutral-400">({p.romaji}) — {p.en}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={startSessionAction} className="mt-8">
        <input type="hidden" name="scenarioId" value={scenario.id} />
        <input type="hidden" name="level" value={level} />
        <button className="rounded bg-neutral-900 px-4 py-2 text-white hover:bg-neutral-700">
          Enter
        </button>
      </form>
    </main>
  );
}
