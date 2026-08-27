import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const message = typeof params.message === "string" ? params.message : null;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <div className="text-xs tracking-[0.3em] mb-1 text-noren-amber">くぐる</div>
        <h1 className="jp text-3xl">暖簾</h1>
        <p className="text-sm mt-1 text-noren-dim">Push through the curtain.</p>
      </div>

      {message && (
        <p className="px-3 py-2 text-sm border-l-3 border-noren-cyan bg-noren-panel">{message}</p>
      )}
      {error && (
        <p className="px-3 py-2 text-sm border-l-3 border-noren-rose bg-noren-panel">{error}</p>
      )}

      <form action={login} className="flex flex-col gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="px-3 py-3 outline-none bg-noren-bg border border-noren-edge text-noren-ink"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="px-3 py-3 outline-none bg-noren-bg border border-noren-edge text-noren-ink"
        />
        <button
          type="submit"
          className="mt-2 py-3 font-semibold uppercase tracking-[0.2em] bg-noren-amber text-noren-bg"
        >
          Sign in
        </button>
      </form>

      <p className="text-sm text-noren-dim">
        No account?{" "}
        <Link href="/signup" className="text-noren-amber">
          Sign up
        </Link>
      </p>
    </main>
  );
}
