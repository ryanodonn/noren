import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";

export async function NavBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link href="/" className="font-semibold">
        暖簾 Noren
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/" className="hover:underline">
          Scenarios
        </Link>
        <Link href="/vocab" className="hover:underline">
          Vocab
        </Link>
        <form action={logout}>
          <button type="submit" className="text-neutral-500 hover:underline">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
