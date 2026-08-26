# Noren

Japanese conversation-practice app. Every scenario is walking into a place and talking to whoever's inside (konbini, izakaya, ...) — pre-authored dialogue, graded turn by turn, missed vocabulary becomes spaced-repetition flashcards, progression is a suggestion the learner accepts or dismisses.

Read before making product or architecture decisions:
- [`docs/requirements.md`](docs/requirements.md) — what we're building and why. Has an "Assumptions to confirm" section — check it hasn't gone stale.
- [`docs/services.md`](docs/services.md) — bounded contexts, ownership, the progression/SRS/completion algorithms. Source of truth for module boundaries.

## Architecture (from docs/services.md — don't relitigate here, go fix the doc if it's wrong)

- **Modular monolith, one Next.js deployment.** No microservices until a module hits a concrete trigger (independent scaling, different runtime, third-party consumer) — see services.md §0.
- **Module boundaries are enforced in code**, not just convention: each module (Identity, Catalog, Content Generation, Speech, Session & Attempt, Progression, Vocabulary) owns its own tables and exposes a typed interface. Don't query another module's tables directly — call its exported function.
- **Cross-module calls are direct function calls, not an event bus.** Session & Attempt calls Progression/Vocabulary/Catalog directly after its own write commits. Each call is individually try/caught and logged so a failure there never fails the session write (services.md §4-5). Do not introduce a typed emitter, queue, or pub/sub layer for this — it was deliberately removed as premature for a single-process app talking to one Postgres instance. Revisit only if a module is actually extracted to its own service.
- **The drill path never depends on an analytical context.** Progression and Vocabulary being down must never block a session/attempt write.

## Stack

- Next.js (TypeScript), Tailwind
- Supabase: Postgres + Auth. Project `noren` (ref `ykapxecddtrnzdcefwvd`, region `us-east-1`).
- Env vars: see `.env.example`. Real values live in `.env.local` (gitignored) — never commit them.

## Conventions

- Organize app code by module/bounded context (folder-per-context), matching services.md, not by technical layer.
- FSRS (not SM-2) for flashcard scheduling.
- Levels and scenario variants are data (DB rows), not code — adding one is a migration/seed, not a deploy.
- **No live LLM, no API key, deliberately (services.md §2.3, requirements.md §6).** Content Generation serves a hand-authored dialogue bank (`generated_dialogues`/`generated_lines`, `prompt_version = 'authored-v1'`) and grades with rule-based fuzzy matching against authored `acceptable_ja`/`acceptable_romaji` sets — not an Anthropic/OpenAI/etc. call. Don't reintroduce an SDK dependency here without discussing it first; if you're asked to "make grading smarter" or "generate more dialogue," that means authoring more content or improving `src/modules/content-generation/grading.ts`, not wiring up a model.
