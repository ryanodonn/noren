import Link from "next/link";
import { signup } from "../login/actions";

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Noren</h1>
        <p className="text-sm text-neutral-500">Create an account.</p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <form action={signup} className="flex flex-col gap-3">
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
          minLength={6}
          placeholder="Password"
          className="rounded border px-3 py-2"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-700"
        >
          Sign up
        </button>
      </form>

      <p className="text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
