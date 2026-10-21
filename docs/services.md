# Noren — Service Decomposition

Bounded contexts, ownership boundaries, and the algorithms behind progression, flashcards, and scenario completion.

---

## 0. Deployment posture

**Recommendation: modular monolith with enforced seams.** Build every context below as an isolated module in a single Next.js deployment. Enforce boundaries in code — each module exposes a typed interface, owns its tables, and never reaches into another module's schema.

Split a context into a real service only when one of these is true:

| Trigger | Likely first candidate |
|---|---|
| It needs to scale independently | Content Generation (LLM-bound, bursty) |
| It needs a different runtime | Speech (long-running audio, streaming) |
| Its failure must not take down the app | Speech, Content Generation |
| A third party needs to consume it directly | Progression, Vocabulary |

Everything below is written so that the extraction is a transport change, not a redesign: synchronous calls become HTTP, in-process events become a queue.

**The cost of getting this wrong in the other direction is worse.** Splitting early means a session write and a grade write become a distributed transaction. Don't.

---

## 1. Context map

```
                        ┌─────────────────┐
                        │    Identity     │
                        └────────┬────────┘
                                 │ user_id
      ┌──────────────┬───────────┼───────────┬──────────────┐
      │              │           │           │              │
┌─────▼─────┐  ┌─────▼─────┐  ┌──▼──────┐ ┌──▼─────────┐ ┌──▼────────┐
│  Content  │  │  Speech   │  │ Session │ │Progression │ │Vocabulary │
│ Generation│  │           │  │ & Attempt│ │            │ │   (SRS)   │
└─────┬─────┘  └───────────┘  └────┬────┘ └──▲─────────┘ └──▲────────┘
      │                             │        │              │
      │  direct calls               │  direct calls          │
      └─────────────────────────────┼────────┴──────────────┘
                                    │
                            ┌───────▼────────┐
                            │   Catalog      │
                            │ (scenarios,    │
                            │  completion)   │
                            └────────────────┘
```

Session & Attempt is the **write hub**. Once a session/attempt write commits, it directly calls into Progression, Vocabulary, and Catalog — plain function calls, not a message bus. This keeps the learner-facing write path fast and lets the analytical contexts fail without blocking a drill (see §4).

---

## 2. Services

### 2.1 Identity
**Owns:** users, auth, preferences (default level, script preference, voice assignments, TTS vendor).

**Surface**
```
GET  /me
PATCH /me/preferences
```

**Why separate:** everything depends on it, it depends on nothing. Trivially replaceable by Supabase Auth — this context is mostly a thin wrapper plus a preferences table.

---

### 2.2 Catalog
**Owns:** scenario definitions, variants, level definitions, and **per-user completion state**.

This is the context that answers *"what should this user be offered next?"* — and critically, *"what have they already done?"*

**Surface**
```
GET  /scenarios?level={level}          → available, with completion state
GET  /scenarios/{id}/next-variant?user_id=&level=   → selects an unplayed variant
POST /scenarios/{id}/reset             → explicit user request to replay
```

**Owns tables**
```sql
levels             -- id, label_ja, label_en, sort_order, spec, rate, example_dialogues jsonb
scenarios          -- id, slug, name_ja, name_en, line_label, speaker_a, speaker_b
scenario_variants  -- id, scenario_id, description, active
scenario_completion-- user_id, scenario_id, variant_id, level, completed_at,
                   -- score, PRIMARY KEY (user_id, variant_id, level)
```

`levels.spec` is the grammar/vocabulary constraint fed into Content Generation's prompt (§2.3); `levels.rate` is the TTS playback rate for that level (§2.4), increasing from 0.65 at 幼児 to 1.05 at N4 — the drill literally sounds faster and more natural as level increases, not just harder in content. `levels.example_dialogues` is an array of small hand-written 2-line exchanges (4 per level) demonstrating that level's exact vocabulary/grammar ceiling (see §2.3) — added after `spec`-only prompting proved too abstract for Gemini to calibrate against consistently, then expanded from one example to four so the model has multiple patterns to generalize from instead of one phrasing to imitate too closely.

No separate briefing content (`where_text`/`who_text`/`goal_text`/`opener_text`/`persona_prompt`, plus a `seed_phrases` table) — that schema existed in an earlier iteration and was dropped along with the separate briefing page it backed (see below). `scenario_variants.description` is a short scene seed (e.g. *"a customer checking out with a bento that needs heating"*) fed straight into Content Generation's prompt, not authored copy shown to the learner.

**The learner is never `speaker_a`/`speaker_b`.** Both are other people — `speaker_a` is conventionally the staff/host role (店員, 駅員, 運転手...), `speaker_b` the customer/passenger role (客, 乗客...). The learner eavesdrops and translates every line, both speakers, into English (see §2.3). This wasn't the original design — see requirements.md §1 for how that got corrected — and it's also why there's no separate briefing step: nothing to brief, the learner just picks a scene and level and listens in. Level and scenario selection is a single combined picker screen, not a browse-then-brief flow.

**Called by:** Session & Attempt, on session completion (`markScenarioCompletion`).

**Extraction note:** the completion table is the only part that's user-scoped. If Catalog is ever extracted, completion may be better placed with Session — evaluate at extraction time.

---

### 2.3 Content Generation
**Owns:** dialogue content and grading. A shared pool of hand-authored and Gemini-generated dialogues, filled only by a scheduled cron; grading is rule-based with no LLM at all.

**History (relevant — this flip-flopped twice):** originally designed as an LLM-bound wrapper around Claude. Went LLM-free for a build pass (real per-app API key, real ongoing cost, for a project with zero users yet) — dialogues became a fixed hand-authored bank, grading became pure rule-based word-overlap matching, hints became static tiers. Then the actual target UX turned out to need 7 scenarios × 6 levels of dialogue that's fresh every time — 210+ combinations, never repeating — which hand-authoring can't realistically cover. Live generation came back, via **Gemini** (`@google/genai`, model `gemini-3.6-flash`, Google AI Studio free-tier key — not Anthropic, not Vertex AI) rather than the original Claude plan, because a free tier exists and the user already had a Google account. (Originally wired up against `gemini-2.5-flash`; switched to `gemini-3.6-flash` after Google stopped issuing 2.5-flash access to new API keys.) The rule-based grader from the LLM-free phase wasn't thrown away, and as of 2026-10 it is the **only** grader again — see "Gemini is cron-only" below for why the LLM came off the grading path entirely. Generation stayed.

**Surface (in-process, per §4 — not literal HTTP)**
```
getDialogue(scenario, variant, level, { excludeDialogueIds })
                                       → serves a pooled dialogue, preferring one not in
                                         excludeDialogueIds; returns { dialogue, alreadyHeard }
                                       → throws PoolEmptyError on an empty key. Never generates.
grade(lineId, userAnswer)              → rule-based word-overlap against the line's own `en` +
                                         its `acceptable_en`, each expanded over mechanical
                                         phrasing variants. Returns { verdict, note, score }.
generateDialogue(..., { admit })       → the ONLY path that spends a Gemini request. Cron only.
getPoolDepths()                        → depth per key, from the `pool_depths` view
planGenerationGaps(candidates, opts)   → pure: which gaps the cron should fill next
getGeneratorHealth()                   → analytical; never throws, returns null on failure
```

**The direction is translation, not production.** The learner is never one of the two speakers (§2.2) — every line, both speakers, gets played in Japanese (audio-first — see below), and the learner types or speaks its English translation. Every line is graded; there's no passive/interactive split by speaker.

**Audio-first, not read-first.** Nothing about a line is shown before the learner answers except which speaker is talking — no transcript, no translation. They hear it (▸ Play, or Slower at 0.6× the level's rate) and answer from listening alone. Hints (below) are the only way to see any text before answering, and they're opt-in and graduated.

**Grading, concretely:** the primary path is a Gemini call — *"grade generously, meaning matters, exact wording does not"* — returning `{verdict, note}` with a specific note about what was misread on anything less than `got_it`. If that call fails (network, quota, parse failure — anything), it falls back to **word-overlap (Dice coefficient) similarity** against `[line.en, ...line.acceptable_en]`: tokenize both into normalized word sets, score by `2×|intersection|/(|A|+|B|)`. This tolerates reordering and filler-word differences far better than character-level edit distance would for English answers, at the honest cost of missing same-meaning-different-words paraphrases the LLM path would have caught. Pure, tested — `src/modules/content-generation/grading.ts`.

**Dialogue generation prompt, concretely:** built in `prompts.ts` from the scene, both speakers' roles, the variant's seed description, and the level's `spec` text *plus* its `example_dialogues` (§2.2) — 4 concrete exchanges at that exact difficulty, each numbered and injected verbatim into the prompt as "match this vocabulary/grammar ceiling precisely... vary your phrasing across these patterns rather than copying just one." `spec` alone (prose like *"casual contractions ちゃう、とく、んだ"*) left Gemini interpreting the band loosely; giving it real examples at each level anchors the output far more reliably — confirmed live: an N4 generation used all three named contraction patterns from its examples, not just some of them. Started as one example per level, expanded to four so the model has multiple phrasing patterns to draw from instead of a single template it could overfit to. Examples were originally 2-line snippets (isolated Q&A, useful for register but not shape); rewritten (2026-09) to full 6-8 line dialogues matching the actual length Gemini is asked to produce, and to read as walking in on a scene already in progress rather than a textbook greeting-first exchange — matching the core mechanic (README: "you're never a participant"). Confirmed live: re-tested against the n4 examples and the model picked up the in-media-res framing and the exact casual-contraction patterns (しといて/しときますか-style) unprompted.

**Free tier quota is two limits, not one, and conflating them cost us three weeks.** Google AI Studio's free tier caps `gemini-3.6-flash` at **5 requests per minute** and **20 per day**. The 429 body names which one was hit, in both `limit: N` and a `quotaId` like `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`.

The distinction is operationally opposite: the per-minute cap means *pace the calls*, the daily cap means *make fewer of them*. Because the log only stored `category = 'quota_exceeded'`, the two were indistinguishable, and the seed cron's burst problem read as "we're out of quota" for three weeks. The actual numbers: **all 47 of the cron's 429s were the per-minute cap, and not one was the daily cap.** The daily cap was only ever reached by LLM grading (31 times) and the background top-up (3) — both now removed, which handed ~28 requests/day back to the cron.

Note the per-minute limit is a *moving* external constraint, not a fixed one: it dropped to 5 around **2026-09-14** with no change on our side (the cron had been succeeding 6-for-6 before that date, and started failing 4-6 of 6 every day after). `parseQuotaError` in `classify-error.ts` extracts both facts so this is never again inferred from a bare category.

**Thinking is on by default for this model family, and it was the actual cause of "grading feels slow," not network latency.** Left unset, `gemini-3.6-flash` defaults to a "medium" reasoning level — real overhead for a task like grading a single short translation, which needs zero reasoning. `callGemini` sets `thinkingConfig.thinkingLevel` explicitly: `LOW` for dialogue generation, which is now its only caller (a rejected or malformed response there has no fallback, just a retry, and a retry costs a request against a per-minute cap of 5). The historical note below is about grading, which no longer goes through a model at all — kept because it explains why the code is shaped this way. Confirmed live: grading dropped from the 10-30s+ range to consistently under 2 seconds end to end (`submitAttempt` logged at ~1-2s total, including the DB round trips around it) with no change to grading quality — the model still returns the same `{verdict, note}` shape either way, thinking just added latency without adding accuracy for a task this small.

**Generation validates before it ever reaches the pool, and every failure is categorized and logged.** `validation.ts` runs the same checks `scripts/seed-content/build-sql.mjs` runs on hand-authored content (6-8 lines, speakers **strictly alternate with either speaker opening**, every required field present, and — the one that matters most — each line's `tokens` reconstruct its `ja` text exactly) against Gemini output before `insertDialogueWithLines` ever runs. A malformed row that slipped through wouldn't just fail once; it'd sit in the pool serving a broken tap-to-reveal to every learner who drew it later. `classify-error.ts` maps whatever actually threw — a Gemini `ApiError` by HTTP status, a `ModelJsonParseError`, this new `DialogueValidationError`, a Postgres error by SQLSTATE shape, or a message-pattern guess — onto a fixed category (`quota_exceeded`, `model_unavailable`, `auth_error`, `network_error`, `empty_response`, `parse_error`, `validation_error`, `db_error`, `unknown`), and `error-log.ts` writes one row per attempt to `generation_attempts` before rethrowing — logging is fire-and-forget from the caller's perspective and never itself fails the actual request (mirrors the failure-isolation principle in §4). This is what makes "how often does izakaya fail at N4, and why" a query instead of a grep through Vercel logs.

**The log records successes too, which is what gives the failure count a denominator.** It was `generation_errors` until 2026-10; renaming it to `generation_attempts` (a rename, so all 144 historical rows survived as `outcome='failure'`) turned "how often does this key fail" from an unanswerable question into one `GROUP BY`. The row also now keeps what `err.message` alone threw away: `http_status`, and a `details` jsonb holding validation's individual `issues`, a truncated `raw` payload on a parse failure, the parsed quota facts, any repair notes, and `attempts` — the traces of calls that failed and were retried past. That last one closed a real blind spot: the retry wrapper used to swallow the first failure entirely, so a run that failed once and then succeeded left no trace at all. One row per generation *run*, not per HTTP call, so the failure rate has the right denominator.

**`source` is a real indexed column recording who triggered the generation (`live` | `background_top_up` | `cron` | `backfill`)** — promoted out of the `context` jsonb, where no index could cover it. `stage` alone couldn't answer "did this actually block a learner," since a live pool-miss and the cron's pre-seed both landed under stage `generation`. Filtering `source = 'live'` was the query for "did a real learner hit this."

**That query is the reason the live path no longer exists.** Across the whole history of the table there is not one `source = 'live'` row — every learner request was served from the pool, and the live-generation branch absorbed all of the latency and quota risk while never once being the thing that helped. `live`, `background_top_up` and `pool_top_up` are retained as historical-only values (rows written under them still exist, and there is no DELETE policy on any table); every new row is `stage = 'generation'` with `source` of `cron` or `backfill`. First real-world read of this table (2026-09) showed exactly why the distinction matters: every `network_error` logged so far was a Gemini 503 ("high demand"), all clustered once daily — the seed-generation cron hitting transient overload, not a single one from a live learner request. Since a 503 is gone on the very next request, `callGeminiWithRetry` retries once (jittered ~1s) on `network_error` specifically.

**It deliberately does not retry a 429**, even though that is now the most common failure. The body asks for a 5-44s wait (19s on average) — which does not fit inside a 60s invocation — and spending a request against the daily cap to get a near-certain second rejection is worse than not trying. Pacing is the fix for a 429, not retrying. The retry is also admission-gated: the caller passes an `admit(needMs)` predicate, so the cron only allows a retry that fits both its wall-clock deadline and its remaining request budget.

**The cron is now the only thing that fills the pool, so *which* gaps it picks matters more than how many it gets through.** `GET /api/cron/seed-generation` runs twice daily (`vercel.json`, 02:00 and 14:00 UTC — Hobby caps each entry at once-per-day cadence but allows more than one entry; 12 hours apart means zero per-minute interaction between runs).

**Pacing.** Two budgets, both enforced. Wall clock stops at 50s against Hobby's 60s ceiling. Requests stop at 5, because the per-minute cap *is* 5 and a 60s invocation *is* one minute — so six calls cannot succeed no matter how they're arranged. That is precisely what the previous version was hitting: it fired all six picks at once via `Promise.all` and 4-6 came back 429 every single day. Now 4 picks start 8s apart (t = 0, 8, 16, 24s; the last one's p95 completion lands at 49s), leaving exactly one request for a retry. The stagger earns its keep even though the cap is a counter rather than a concurrency limit, because the observed rejection pattern was 3-4 of 6 rather than exactly 1 of 6 — admission is burstier than a clean rolling window.

A pick that cannot fit the budget is skipped, and **a skipped pick writes no `generation_attempts` row at all** — nothing was attempted, so logging it would inflate the very failure rate the table exists to expose and trip the health strip's spike trigger.

**Prioritization — the highest-leverage part of this whole pipeline.** `planGenerationGaps` (pure, unit-tested) orders gaps: levels at least one learner is currently on first (`Progression.listActiveLevels`) and *only* those unless no such gap exists, then shallowest depth first, then keys that haven't failed in the last day, then least-recently attempted, at most one pick per variant per run.

Why it matters this much: the pool has **198 keys** (33 active variants × 6 levels), and filling them all to `POOL_MIN` is ~873 dialogues — roughly four months at the sustainable free-tier rate. But 618 of those are for levels **nobody has ever opened**. The gaps that can actually dead-end a learner are the depth-0 keys at a level someone is playing, and there were 19 of them, all at 幼児. Uniform-random picking spent five of every six calls on unreachable content; ordering this way clears the blocking set in days instead. Falling through to other levels only when the priority set is empty also means a learner promoting into 小学生 redirects the cron there on its very next run, with no code change.

`GAP_TARGET_DEPTH` (3) is deliberately distinct from `POOL_MIN` (5): `POOL_MIN` means "this pool is thin," `GAP_TARGET_DEPTH` means "what to fill next," and keeping the chase shallower roughly halves the work. They were only ever the same number because the background top-up shared the threshold, and that coupling left with it.

Auth is Vercel's own pattern: the route checks `Authorization: Bearer $CRON_SECRET` and 401s otherwise, so the endpoint can't be hit publicly to burn quota. Runs via a service-role Supabase client (`src/lib/supabase/service.ts`, `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS) since there's no logged-in user to scope a cookie-based session to — the only place in the app that isn't the cookie-scoped `server.ts` client, and it must never be used to handle an actual learner's request.

**Every "start a session" entry point shares one client hook (`src/app/pick/useStartSession.ts`)** rather than each screen handling generation failure differently. Starting a session is now a pool read of ~100ms rather than a 10-30s Gemini call, so the elapsed-seconds counter and indeterminate progress bar it used to drive are gone. What remains is mapping a **typed** failure reason to copy a learner can act on: `startSessionAction` returns `{ ok: false, reason }` rather than throwing, and the hook turns `pool_empty` / `no_variants` / `unknown` into distinct messages. The distinction matters because `pool_empty` cannot be fixed by retrying — the copy has to say "try another scene," not "try again." (`redirect()` is called outside the action's try block on purpose: it signals navigation by throwing `NEXT_REDIRECT`, which a catch would swallow.) The Pick screen and the Done screen's "Another dialogue, same level" retry both use it (named "another", not "new", since it draws a different pooled dialogue rather than writing one); the Done screen previously called a bare server action from a plain `<form>` with no error handling at all, so a failure (e.g. the free-tier quota above) crashed to Next's default error page instead of showing a message.

**Hints, concretely:** three tiers, client-rendered from data already loaded (no round-trip) and **stacking** — at tier 2 you see both tier 1 and tier 2, not just tier 2:
1. `gist` — a short nudge ("asking about the price") that must not give away the translation
2. `key_ja`/`key_romaji`/`key_en` — the single hardest word in the line, glossed
3. `kana`+`romaji` — the full reading, so a learner who misheard can check, but they still have to translate it themselves

None of the three tiers ever reveals `en` — see `src/modules/content-generation/hints.ts` (pure) and its client-safe re-export `client.ts` (DrillClient, a client component, needs this without pulling in the Gemini client — see §0's module-boundary note in CLAUDE.md).

**Owns tables**
```sql
generated_dialogues -- id, scenario_id, variant_id, level, setting, prompt_version,
                    -- created_at, model
generated_lines     -- id, dialogue_id, seq, speaker, ja, kana, romaji, en,
                    -- gist, key_ja, key_romaji, key_en, tokens jsonb, audio_url,
                    -- acceptable_en jsonb
generation_attempts -- id, occurred_at, outcome, stage, category, source, scenario_id,
                    -- variant_id, level, message, http_status, duration_ms,
                    -- attempt_count, details jsonb, context jsonb — see below
pool_depths (view)  -- scenario_id, variant_id, level, depth — security_invoker, so it
                    -- inherits generated_dialogues' own RLS; a view can't carry a policy
```

`tokens` must reconstruct the full line when concatenated in order — it's what makes the post-answer "tap any word" reveal possible. Hand-authored rows from the LLM-free phase only tokenized notable vocabulary, not the whole sentence; the reveal UI checks reconstruction and falls back to plain (non-tappable) text for those rows rather than rendering a sentence with gaps.

**Cache strategy:** hand-authored rows and live-generated rows share one pool per `(scenario, variant, level)` — `prompt_version`/`model` are provenance metadata (which generation era wrote this row), not a partition key, so `getDialogue`'s pool lookup doesn't filter on them. **Picks a dialogue the learner hasn't heard**, falling back to a flagged repeat (`alreadyHeard`, surfaced as a `HEARD BEFORE` chip in the drill header) rather than nothing — with no live generation left, refusing to re-serve would turn an exhausted pool into a dead end. Selection is count-then-offset in SQL (PostgREST can't `order by random()`), so one row crosses the wire regardless of pool size.

The exclusion set is passed *in* by Session rather than looked up here: dialogue history lives in `sessions.dialogue_id`, which is Session's table, so `Session.startSession` reads its own history and hands over the ids (§4). `sessions.is_replay` is deliberately **not** reused for this — it already means "variant-level replay after the scenario was exhausted" and feeds `Catalog.markScenarioCompletion`, `Progression.evaluate`, and the `is_replay` filter behind "areas to improve"; overloading it would quietly corrupt progression evidence.

**Grading's paraphrase tolerance is now the whole accuracy budget, and `0.97` is not the lenient threshold it looks like.** For normalized word sets of sizes *a* and *b* sharing *k* words, the Dice coefficient is `2k/(a+b)`; the best two *non-identical* sets can score is `2a/(2a+1)`, which for a five-word answer is 0.909. Clearing 0.97 needs ~17 words, and lines here are 3-8. **So for any real line, `got_it` means the word sets are exactly equal** — there is no partial-credit band above `close`. That makes candidate breadth the only lever on accuracy, and it comes from three places: the line's own `en`, its `acceptable_en` (which the generation prompt now asks for, 3-5 phrasings per line — Gemini-generated lines used to store `[]`), and `phrasings.ts`, a pure bidirectional expander over contractions and a small closed synonym set. That last one is why `"I'd like a bag"` vs `"I would like a bag"` now scores 1.0 instead of 0.667; it costs no quota and applies retroactively to every line already pooled. What it cannot do is semantic synonymy — `"heat it up"` vs `"warm it up"` share no words — which is exactly what `acceptable_en` is for. `attempts.score` persists the raw score so retuning the threshold stays an evidence-based decision rather than a guess. Debriefs are still not LLM-written prose; the done screen is a plain score tally + full script recap (matches the cloned reference — see requirements.md §3).

**Pre-seeding the pool without spending Gemini calls.** `scripts/seed-content/` is a small reusable pipeline for hand-authoring pool content directly — no API call at all, so it costs nothing against the free-tier quota above. **It is now the only lever on pool depth with no ceiling whatsoever**, and the evidence that it works is in the data: 子供 is the one level with zero dead-end keys, precisely because 32 of its dialogues were hand-authored. `scripts/seed-content/data/*.json` holds one file per `(scenario, level)` batch, each an array of dialogue objects (`scenario_slug`, `variant_id`, `level`, `setting`, `lines[]` — same shape `generateAndStore` produces). `scripts/seed-content/build-sql.mjs` validates each one (6-8 lines, speakers strictly alternate with either speaker opening, every required field present, and — the check that matters most — each line's `tokens[].ja` concatenate to reconstruct that line's `ja` exactly) and emits ready-to-run SQL that inserts through the same `generated_dialogues`/`generated_lines` tables, tagged `model: 'claude-authored'` so it's identifiable in the data but still shares the pool with Gemini-generated rows (not a partition key, per above). Used once already to seed all 35 active variants across all 7 scenarios at 子供 (kodomo, the default level for new users) — every scenario/variant a new learner can land on has pooled content before they ever hit "Start listening" — which, now that there is no live generation at all, is the only reason 子供 has no dead ends. To add more: write a new data file in the same shape, run `node scripts/seed-content/build-sql.mjs path/to/file.json`, and apply the printed SQL.

---

### 2.4 Speech
**Owns:** STT and TTS. The only context touching audio.

**Browser-native, no server surface — this one wasn't reversed.** A paid STT/TTS vendor is another API key and another ongoing cost for a context whose only job is "make sound," and unlike Content Generation, nothing about the product's actual scope forced the issue. Implemented as a client-side hook (`src/modules/speech/useSpeech.ts`) over the Web Speech API: `SpeechSynthesis` for TTS, `SpeechRecognition` for STT. Zero cost, zero keys — at the cost of being genuinely browser-dependent (`SpeechRecognition` doesn't exist in Firefox, and is unreliable in Safari) and lower voice quality than a real vendor.

**Interface, concretely**
```
speak(text, { voiceName?, rate?, pitch?, lang? })  → plays audio via SpeechSynthesis
listen({ lang? })                                  → Promise<string>, via SpeechRecognition
```

**Per-speaker voice assignment.** Two speakers need to sound distinct for a listening drill to be followable at all. The pick screen enumerates `ja-*` voices via `speechSynthesis.getVoices()`, ranks known-good ones first, and lets the learner assign one to each speaker role (saved to `Identity`'s `profiles.voice_assignments`). If the device only has one Japanese voice, both speakers share it with a faked pitch offset (0.9 / 1.12) as a last-resort differentiator rather than sounding identical.

**If a real vendor is added later:** the interface above is deliberately vendor-shaped (text→audio, audio→text) so swapping in a paid STT/TTS provider behind it is the transport change this doc's extraction philosophy (§0) is meant to make cheap — not a redesign of anything that calls it.

---

### 2.5 Session & Attempt
**Owns:** the learner's actual activity. The system of record for what happened.

**Surface**
```
POST /sessions                    { mode, scenario_id, level }
POST /sessions/{id}/attempts      { line_id, user_answer, verdict, hints_used, note }
POST /sessions/{id}/lookups       { token }
POST /sessions/{id}/complete
GET  /sessions?user_id=&limit=
GET  /sessions/{id}
```

**Owns tables**
```sql
sessions   -- id, user_id, mode, scenario_id, variant_id, level, dialogue_id,
           -- started_at, completed_at, abandoned boolean
attempts   -- id, session_id, line_id, seq, user_answer, verdict,
           -- hints_used smallint, note, latency_ms, score real, answered_at
lookups    -- id, session_id, user_id, token_ja, kana, romaji, en, looked_up_at
```

**Calls directly, on the critical path** (allowed to fail the start, unlike the post-commit calls below):
```
startSession(...)  → db.getPlayedDialogueIds(user, pool key)   -- its own table
                   → ContentGeneration.getDialogue(..., { excludeDialogueIds })
```
Session reads its own dialogue history and passes an exclusion set, rather than letting Content Generation reach across into `sessions` (§2.3, "Cache strategy"). A `PoolEmptyError` from that call is mapped to `StartSessionError("pool_empty")` so callers depend on one module's error type. `getSession` recomputes `alreadyHeard` the same way, from `countPriorPlays`, so the drill's badge survives a reload with no stored column.

**Calls directly, after its own write commits** (see §4 for the failure-handling contract):
```
onAttemptRecorded(attempt)   → Vocabulary.harvestFromAttempt(attempt)
onLookupRecorded(lookup)     → Vocabulary.harvestFromLookup(lookup)
onSessionCompleted(session)  → Progression.evaluate(user_id, summary)
                              → Catalog.markScenarioCompletion(...)
```

**Design note:** `hints_used` is as important as `verdict`. A correct answer after three hints is not the same as a cold correct answer, and the progression algorithm must see both. Record hints even when the learner ultimately gives up.

Store `abandoned` explicitly. A learner quitting mid-session is signal — likely that the level is too hard — and should not be silently discarded.

---

### 2.6 Progression
**Owns:** difficulty recommendations. Consumes attempts, produces a recommendation.

**Surface**
```
GET  /progression/{user_id}                  → current level, recommendation, evidence
POST /progression/{user_id}/accept           → apply a promotion/demotion
POST /progression/{user_id}/override         → manual level set
```

**Owns tables**
```sql
level_state   -- user_id, level, since, sessions_at_level, manual_override boolean
level_events  -- id, user_id, from_level, to_level, reason, accepted boolean, created_at
```

**Called by:** Session & Attempt, on session completion.

#### Progression algorithm

Evaluated on a **rolling window of the last 30 attempts at the current level**, requiring a minimum of 20 before any recommendation fires.

Define per attempt:
```
unaided_correct = (verdict == "got_it" AND hints_used == 0)
assisted        = (verdict == "got_it" AND hints_used > 0)
```

**Promote when all hold:**
| Signal | Threshold |
|---|---|
| Unaided correct rate | ≥ 75% |
| Mean hints per attempt | ≤ 0.5 |
| Missed rate | ≤ 10% |
| Sessions completed at level | ≥ 3 |
| Distinct scenarios at level | ≥ 2 |

The last two matter: mastering one scenario means learning that scenario's vocabulary, not the level. Requiring breadth prevents promotion on memorized content.

**Demote when either holds:**
| Signal | Threshold |
|---|---|
| Missed rate | ≥ 40% |
| Mean hints per attempt | ≥ 2.0 |
| Consecutive abandoned sessions | ≥ 2 |

**Behavior**
- Recommendations are **suggestions, never automatic.** Surface as "You're ready for 小学生 — 82% unaided over your last 30 lines." The learner accepts or dismisses.
- A dismissed promotion doesn't re-fire until 20 further attempts accumulate.
- Demotion is phrased as an offer, never a demotion: *"Want to drop back to 子供 for a bit?"* Framing matters more here than the threshold.
- `manual_override` suppresses all recommendations until cleared.

**Why separate:** the thresholds above are guesses that will need tuning against real data. Isolating this means retuning is a single deploy with no risk to the drill path, and the whole algorithm is unit-testable against synthetic attempt streams.

---

### 2.7 Vocabulary (SRS)
**Owns:** what the learner is missing, and the flashcard queue.

**Surface**
```
GET  /vocab/{user_id}/due?limit=          → cards due for review
POST /vocab/{user_id}/review              { card_id, rating }
GET  /vocab/{user_id}/stats
POST /vocab/{user_id}/suspend             { card_id }
```

**Owns tables**
```sql
vocab_cards   -- id, user_id, token_ja, kana, romaji, en,
              -- source enum('missed','lookup','manual'),
              -- first_seen, times_missed, times_looked_up,
              -- stability, difficulty, due_at, last_reviewed, suspended,
              -- UNIQUE (user_id, token_ja)
vocab_reviews -- id, card_id, rating, reviewed_at, elapsed_days, scheduled_days
```

**Called by:** Session & Attempt, on every attempt and lookup.

#### Card creation rules

Two intake paths, weighted differently — this distinction matters:

| Source | Trigger | Initial priority |
|---|---|---|
| **missed** | Attempt verdict was `missed` or `close` → harvest tokens from that line | High — demonstrated failure |
| **lookup** | Learner tapped a token for a gloss | Medium — curiosity or uncertainty, not proven failure |

A tapped word is weaker evidence than a missed line. Both become cards, but `missed` cards enter the queue with shorter initial intervals.

**Noise control** — without filtering, every particle and copula becomes a card:
- Maintain a **stoplist** of high-frequency function words (は、が、を、です、ます、の…). Excluded from automatic creation; addable manually.
- Require **≥2 occurrences** before a `lookup`-sourced token becomes a card. One tap is curiosity; two is a gap.
- `missed`-sourced tokens create a card on first occurrence.
- Cap new cards at ~10/day so the queue stays reviewable.

#### Scheduling

Use **FSRS** rather than SM-2. It handles the "learner already half-knows this from listening practice" case better, and reference implementations exist in TypeScript. Each card carries `stability` and `difficulty`; a review updates both and computes `due_at`.

Ratings map to the four-button standard: `again / hard / good / easy`.

**Cross-context reinforcement:** when a card is due and its token appears in an upcoming generated line, that's a natural review — Content Generation can optionally accept a `prioritize_tokens` hint. Treat as a later optimization; it couples two contexts and shouldn't be in v1.

#### Flashcard mode
A distinct UI surface, not a mode of the drill:
- Audio-first — hear the word, recall the meaning, matching how the vocabulary was originally encountered
- Reveal shows kana, romaji, English, **and the sentence it was originally missed in**, since context is most of what makes a word stick
- Rating buttons feed `/vocab/review`

---

## 3. Scenario completion & replay

### The conflict to resolve

Two requirements are in tension: *"don't replay completed scenarios"* and *"generate fresh dialogue every run so it never repeats."* **As of 2026-10 the pool is genuinely finite again** (§2.3 — generation is cron-only, so a learner's request never creates new content). Completing every pooled dialogue for a `(scenario, variant, level)` means the next play re-serves one, flagged `alreadyHeard`, until the cron adds another. The resolution below still holds — completion is tracked per `(scenario × variant × level)`, not per dialogue — but the premise that "a scenario is never truly exhausted" no longer does.

**Resolution: completion is tracked at `(scenario × variant × level)` granularity.**

- The konbini scenario has 5 variants. At 子供 level, that's 5 completable units.
- The same scenario at 小学生 is a *different* unit — same situation, harder language. Correctly so.
- `GET /scenarios/{id}/next-variant` returns an unplayed variant for that user at that level.

### Exhaustion handling

When all variants at a level are complete, the scenario is marked exhausted for that level, and the UI must do something more useful than hiding it:

| State | Presentation |
|---|---|
| Unplayed variants remain | Offered normally |
| All variants complete at this level | Marked complete; shown with a **replay** option and a badge |
| All variants complete at all levels ≤ current | Deprioritized in the list, not hidden |

**Never hard-hide content.** A learner who wants to redo a scenario should be able to. `Catalog.resetScenario` picks one of the already-completed variants when `getNextVariant` comes back empty — this happens automatically inside `Session.startSession`, not via a separate user-facing "reset" action (the current pick screen has no explicit replay button; it's the same "Start listening" flow either way, flagged `is_replay` internally so it doesn't distort progression statistics).

### Variant supply

Five variants per scenario used to be the practical ceiling when dialogue was hand-authored. With live generation back, the ceiling is gone — each variant seed can produce unlimited distinct dialogues — but variants themselves are still **data, not code**, so adding a new *situation* to a scenario (not just a new dialogue for an existing one) is a database row, not a deploy.

### What counts as complete

A session marks completion when the learner reaches the end of the dialogue — **regardless of score**. Completion means "you did this," not "you passed." Score is recorded separately and drives progression. Abandoned sessions do not mark completion.

---

## 4. Cross-module call contracts

No event bus. Session & Attempt calls the other modules directly, as plain typed function calls, after its own write has committed:

```ts
type Attempt = {
  user_id: string; session_id: string; line_id: string;
  level: LevelId; verdict: 'got_it'|'close'|'missed';
  hints_used: number; tokens: Token[]; occurred_at: string;
};

type Lookup = {
  user_id: string; session_id: string; token: Token; occurred_at: string;
};

type SessionSummary = {
  user_id: string; session_id: string; scenario_id: string;
  variant_id: string; level: LevelId; is_replay: boolean;
  summary: { got_it: number; close: number; missed: number; total_hints: number };
  occurred_at: string;
};

type DialogueGenerated = {
  dialogue_id: string; scenario_id: string; variant_id: string;
  level: LevelId; line_count: number;
};

// Session & Attempt module, called after commit:
async function onAttemptRecorded(attempt: Attempt): Promise<void>;
async function onSessionCompleted(session: SessionSummary): Promise<void>;
```

**Ordering** falls out for free: these are ordinary sequential calls in the same process, so `onAttemptRecorded` calls always happen, in order, before the `onSessionCompleted` call for that session — there's no redelivery or race to guard against. The summary is still carried on `SessionSummary` (rather than making Progression re-tally attempts itself) because it keeps Progression stateless per call, not because of ordering.

**Failure isolation — this is the part that matters, not the event bus:** each call to Progression/Vocabulary/Catalog is wrapped individually (`try/catch`, logged, swallowed) so a failure there never fails the session/attempt write or the learner's HTTP response. Because Progression and Vocabulary derive their state from `attempts`/`sessions` (the source of truth) rather than from blindly-incremented counters, a failed call is safe to recompute later from a queue of failed `session_id`s — recompute-idempotent, without needing message-queue idempotency keys.

**When to revisit this:** only if a module is actually extracted to its own deployment (see §0). At that point "direct call" becomes "HTTP call with retries," and *that's* when queueing and idempotency keys earn their cost. Building that abstraction now, for a single process talking to one Postgres instance, is complexity with no current payoff.

---

## 5. Failure modes and degradation

| Failure | Behavior |
|---|---|
| Dialogue pool empty for a key | `getDialogue` throws `PoolEmptyError`, which `Session.startSession` maps to `StartSessionError("pool_empty")` and the picker renders as a specific "no dialogue is written for this scene at this level yet — try another" message. **This is a real dead end until the next cron run, accepted deliberately** (§2.3): with generation cron-only there is nothing to fall back on, and retrying cannot help, so the copy says to pick another scene rather than to try again. 114 of 198 keys are empty at the time of writing. |
| Grading | Nothing to fail: rule-based, in-process, one indexed row read. There is no LLM on this path and therefore no fallback branch. |
| Generator unhealthy (quota hit, failure-rate spike, or no success in 48h) | Surfaced by the home page's generator strip, from `getGeneratorHealth` — which **never throws, returning `null` instead**, because the dashboard gathers its data in a single `Promise.all` where one rejection would take the whole page down. Blocks nothing. Deliberately does *not* trigger on empty pools: most keys are empty and will be for months, so such a signal would fire permanently and train the reader to ignore the strip. Pool coverage rides along as context only. |
| Hints | Client-rendered from data already loaded — no round-trip, nothing to fail. |
| `SpeechRecognition` unsupported (Firefox, some Safari versions) | Fall back to typed input with the explicit JA/EN toggle. Fully functional, just not hands-free. |
| Progression down | App works; recommendations silently absent. Never block a drill on an analytical service. |
| Vocabulary down | Flashcard mode unavailable; attempts still recorded, cards backfilled from `attempts` on recovery. |

**Principle: the drill path never depends on an analytical context.** Session writes must succeed even if Progression or Vocabulary is throwing on every call — hence each downstream call is caught and logged individually (§4) rather than allowed to fail the write.

---

## 6. What to build first

1. **Session & Attempt + Catalog.** The write path and the content model. Everything else consumes these.
2. **Content Generation** with the dialogue pool cache.
3. **Speech**, TTS first — proven blocker in prototyping, and TTS is the half that unblocks listening mode.
4. **Vocabulary**, harvesting from existing attempts. Cards can be backfilled from historical data, so this can lag without losing anything.
5. **Progression**, last. It needs real attempt data before the thresholds mean anything — shipping it early means tuning against noise.

Build 1–3 as modules in one deployment. Revisit extraction if Content Generation ever grows a real cost/latency profile again (i.e. live generation comes back, per §2.3) — as pre-authored content it has neither.
