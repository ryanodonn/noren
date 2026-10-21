# Noren

Japanese listening-comprehension app. Every scenario is walking in on two *other* people already talking (a konbini clerk and a customer, a taxi driver and a passenger, ...) — you're never a participant. Every line, both speakers, gets played in Japanese and you type/speak its English translation, graded turn by turn. Missed vocabulary becomes spaced-repetition flashcards; progression is a suggestion the learner accepts or dismisses.

Read before making product or architecture decisions:
- [`docs/requirements.md`](docs/requirements.md) — what we're building and why. Has an "Assumptions to confirm" section — check it hasn't gone stale.
- [`docs/services.md`](docs/services.md) — bounded contexts, ownership, the progression/SRS/completion algorithms. Source of truth for module boundaries.

## Architecture (from docs/services.md — don't relitigate here, go fix the doc if it's wrong)

- **Modular monolith, one Next.js deployment.** No microservices until a module hits a concrete trigger (independent scaling, different runtime, third-party consumer) — see services.md §0.
- **Module boundaries are enforced in code**, not just convention: each module (Identity, Catalog, Content Generation, Speech, Session & Attempt, Progression, Vocabulary) owns its own tables and exposes a typed interface. Don't query another module's tables directly — call its exported function. A module may also expose a `client.ts` alongside `index.ts` for the subset of its surface that's safe to import from client components (pure, no server-only code) — `content-generation/client.ts` is the only one so far, for hint logic. ESLint enforces both as the only valid cross-module import paths.
- **Cross-module calls are direct function calls, not an event bus.** Session & Attempt calls Progression/Vocabulary/Catalog directly after its own write commits. Each call is individually try/caught and logged so a failure there never fails the session write (services.md §4-5). Do not introduce a typed emitter, queue, or pub/sub layer for this — it was deliberately removed as premature for a single-process app talking to one Postgres instance. Revisit only if a module is actually extracted to its own service.
- **The drill path never depends on an analytical context.** Progression and Vocabulary being down must never block a session/attempt write.

## Stack

- Next.js (TypeScript), Tailwind. Visual identity is a deliberate dark-only "field notebook" look — Barlow Condensed + Zen Kaku Gothic New, amber accent, hairline grid dividers, sharp corners (see `globals.css`'s `--noren-*` tokens). Don't introduce a light theme or swap in default Tailwind grays.
- Supabase: Postgres + Auth. Project `noren` (ref `ykapxecddtrnzdcefwvd`, region `us-east-1`).
- Gemini (`@google/genai`, model `gemini-3.6-flash`, Google AI Studio free-tier key) for **scheduled dialogue generation only** — a twice-daily cron, never a learner's request. Grading is rule-based with no LLM. See Conventions below; this is the current shape of a reintroduction that started LLM-free.
- Env vars: see `.env.example`. Real values live in `.env.local` (gitignored) — never commit them.

## Conventions

- Organize app code by module/bounded context (folder-per-context), matching services.md, not by technical layer.
- FSRS (not SM-2) for flashcard scheduling.
- Levels and scenarios/variants are data (DB rows), not code — adding one is a migration/seed, not a deploy. Six levels (幼児/子供/小学生/入門/N5/N4), seven scenarios as of this writing.
- **Gemini is cron-only. Nothing on a learner's request path calls a model.** `ContentGeneration.getDialogue` serves from the pool or throws `PoolEmptyError` — it never generates. `ContentGeneration.grade` is purely rule-based (`grading.ts` + `phrasings.ts`). The seed-generation cron is the only caller that spends a Gemini request, which is why `generate.ts` is a separate file: keeping the SDK import out of `index.ts` is a structural guardrail against the live path creeping back.

  Two reasons, both durable. First, the free tier is **5 requests per minute and 20 per day** — that cannot serve an interactive path at all, and LLM grading alone was burning the daily cap 31 times over while competing with the cron for the same budget. Second, in the entire error log there has never been a single `source='live'` row: **no learner ever actually triggered a live generation**, so that path carried all of the latency and quota risk for no realized benefit. See requirements.md §6 and services.md §2.3 for the full history — the project went LLM-free, brought Gemini back for content breadth, and has now confined it to the one place it earns its cost.

- **An empty pool for a (scenario, variant, level) is a dead end until the next cron run.** Accepted deliberately, not an oversight — don't "fix" it by reintroducing live generation. The mitigations are pick prioritization in the cron (levels learners are actually on, shallowest keys first) and hand-authoring via `scripts/seed-content/`, which has no quota ceiling at all.
- The learner never produces Japanese — grading is always translation-direction (Japanese → English). Don't reintroduce a "type the Japanese" mode without discussing it; see requirements.md §1 for why that was the wrong mechanic the first time.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
