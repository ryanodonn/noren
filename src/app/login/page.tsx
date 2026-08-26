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
        <h1 className="text-2xl font-semibold">くぐる</h1>
        <p className="text-sm text-neutral-500">Push through the curtain.</p>
      </div>

      {message && <p className="rounded bg-blue-50 p-3 text-sm text-blue-800">{message}</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <form action={login} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          className="rounded border px-3 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700"
        >
          Sign in
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        No account?{" "}
        <Link href="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
