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
    <header
      className="flex items-center justify-between border-b px-6 py-3"
      style={{ borderColor: "var(--noren-edge)" }}
    >
      <Link href="/" className="jp text-lg">
        暖簾 <span className="text-noren-dim">Noren</span>
      </Link>
      <nav className="flex items-center gap-4 text-xs uppercase tracking-[0.15em]">
        <Link href="/" className="hover:text-noren-amber">
          Pick
        </Link>
        <Link href="/vocab" className="hover:text-noren-amber">
          Vocab
        </Link>
        <form action={logout}>
          <button type="submit" className="text-noren-dim hover:text-noren-amber">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
