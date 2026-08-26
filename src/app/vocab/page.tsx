import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import * as Vocabulary from "@/modules/vocabulary";
import { VocabClient } from "./VocabClient";

export default async function VocabPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cards = await Vocabulary.getDue(supabase, user.id);

  return (
    <main className="mx-auto max-w-md flex-1 px-6 py-10">
      <h1 className="mb-6 text-xl font-semibold">Flashcards</h1>
      <VocabClient cards={cards} />
    </main>
  );
}
