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
**Owns:** dialogue content and grading. Hybrid: a shared pool of hand-authored and live-generated dialogues, LLM grading with a rule-based fallback.

**History (relevant — this flip-flopped twice):** originally designed as an LLM-bound wrapper around Claude. Went LLM-free for a build pass (real per-app API key, real ongoing cost, for a project with zero users yet) — dialogues became a fixed hand-authored bank, grading became pure rule-based word-overlap matching, hints became static tiers. Then the actual target UX turned out to need 7 scenarios × 6 levels of dialogue that's fresh every time — 210+ combinations, never repeating — which hand-authoring can't realistically cover. Live generation came back, via **Gemini** (`@google/genai`, model `gemini-3.6-flash`, Google AI Studio free-tier key — not Anthropic, not Vertex AI) rather than the original Claude plan, because a free tier exists and the user already had a Google account. (Originally wired up against `gemini-2.5-flash`; switched to `gemini-3.6-flash` after Google stopped issuing 2.5-flash access to new API keys.) The rule-based grader from the LLM-free phase wasn't thrown away — it's now the **fallback** when the live grading call fails, which is strictly better than either extreme alone.

**Surface (in-process, per §4 — not literal HTTP)**
```
getDialogue(scenario, variant, level)  → pool hit: serve (top up pool in background if thin)
                                        → pool miss: generate live via Gemini, store, serve
grade(lineId, userAnswer)              → Gemini grades leniently; on failure, falls back to
                                          rule-based word-overlap matching against the line's
                                          own `en` + authored `acceptable_en` (never throws)
```

**The direction is translation, not production.** The learner is never one of the two speakers (§2.2) — every line, both speakers, gets played in Japanese (audio-first — see below), and the learner types or speaks its English translation. Every line is graded; there's no passive/interactive split by speaker.

**Audio-first, not read-first.** Nothing about a line is shown before the learner answers except which speaker is talking — no transcript, no translation. They hear it (▸ Play, or Slower at 0.6× the level's rate) and answer from listening alone. Hints (below) are the only way to see any text before answering, and they're opt-in and graduated.

**Grading, concretely:** the primary path is a Gemini call — *"grade generously, meaning matters, exact wording does not"* — returning `{verdict, note}` with a specific note about what was misread on anything less than `got_it`. If that call fails (network, quota, parse failure — anything), it falls back to **word-overlap (Dice coefficient) similarity** against `[line.en, ...line.acceptable_en]`: tokenize both into normalized word sets, score by `2×|intersection|/(|A|+|B|)`. This tolerates reordering and filler-word differences far better than character-level edit distance would for English answers, at the honest cost of missing same-meaning-different-words paraphrases the LLM path would have caught. Pure, tested — `src/modules/content-generation/grading.ts`.

**Dialogue generation prompt, concretely:** built in `prompts.ts` from the scene, both speakers' roles, the variant's seed description, and the level's `spec` text *plus* its `example_dialogues` (§2.2) — 4 concrete 2-line exchanges at that exact difficulty, each numbered and injected verbatim into the prompt as "match this vocabulary/grammar ceiling precisely... vary your phrasing across these patterns rather than copying just one." `spec` alone (prose like *"casual contractions ちゃう、とく、んだ"*) left Gemini interpreting the band loosely; giving it real examples at each level anchors the output far more reliably — confirmed live: an N4 generation used all three named contraction patterns from its examples, not just some of them. Started as one example per level, expanded to four so the model has multiple phrasing patterns to draw from instead of a single template it could overfit to.

**Free tier quota is a real constraint, not just cost.** Google AI Studio's free tier caps `gemini-3.6-flash` at roughly 20 generate-content requests/day at the time of writing — hit during ordinary manual testing, not load. Every pool miss (§3) spends one of those; a thin day of testing across several new scenario/level combos can exhaust it. Worth watching if usage grows — see the failure-modes table (§5) for what happens when a request fails.

**Generation validates before it ever reaches the pool, and every failure is categorized and logged.** `validation.ts` runs the same checks `scripts/seed-content/build-sql.mjs` runs on hand-authored content (6-8 lines, speakers alternate starting with `a`, every required field present, and — the one that matters most — each line's `tokens` reconstruct its `ja` text exactly) against live Gemini output before `insertDialogueWithLines` ever runs. A malformed row that slipped through wouldn't just fail once; it'd sit in the pool serving a broken tap-to-reveal to every learner who drew it later. `classify-error.ts` maps whatever actually threw — a Gemini `ApiError` by HTTP status, a `ModelJsonParseError`, this new `DialogueValidationError`, a Postgres error by SQLSTATE shape, or a message-pattern guess — onto a fixed category (`quota_exceeded`, `model_unavailable`, `auth_error`, `network_error`, `empty_response`, `parse_error`, `validation_error`, `db_error`, `unknown`), and `error-log.ts` writes one row per failure to `generation_errors` (stage `generation`/`grading`/`pool_top_up`, scenario/variant/level when known, the category, the raw message, and a small `context` jsonb) before rethrowing — logging is fire-and-forget from the caller's perspective and never itself fails the actual request (mirrors the failure-isolation principle in §4). This is what makes "how often does izakaya fail at N4, and why" a query instead of a grep through Vercel logs.

**A daily cron pre-fills the pool ahead of real traffic instead of relying on pool misses at request time.** `GET /api/cron/seed-generation` (Vercel Cron, `vercel.json`, once/day — the Hobby plan's minimum cadence anyway, and it lines up with the quota above) picks, for *every* level, one random `(scenario, variant)` still below a target pool depth (`TARGET_DEPTH = 2`) and generates one dialogue for it — one call per level, so a run costs at most 6 of the ~20 daily requests, deliberately leaving headroom for actual learners. Picks run in parallel (`Promise.all`, bounded by `maxDuration = 60`) since each is a single independent Gemini call; a failed pick doesn't abort the batch — same validation and `generation_errors` logging as any other generation (above), just triggered by a schedule instead of a session. Auth is Vercel's own pattern: the route checks `Authorization: Bearer $CRON_SECRET` and 401s otherwise, so the endpoint can't be hit publicly to burn quota. Runs via a service-role Supabase client (`src/lib/supabase/service.ts`, `SUPABASE_SERVICE_ROLE_KEY`, bypasses RLS) since there's no logged-in user to scope a cookie-based session to — the only place in the app that isn't the cookie-scoped `server.ts` client, and it must never be used to handle an actual learner's request.

**Every "start a session" entry point shares one client hook (`src/app/useStartSession.ts`)** rather than each screen handling generation failure differently. It wraps `startSessionAction` in try/catch with an elapsed-seconds counter (surfaced as "Writing the dialogue… (Ns)" plus an indeterminate progress bar — a 10-30s wait with no feedback reads as broken) and turns any failure into an inline error message instead of an uncaught exception. The Pick screen and the Done screen's "New dialogue, same level" retry both use it; the Done screen previously called a bare server action from a plain `<form>` with no error handling at all, so a failure (e.g. the free-tier quota above) crashed to Next's default error page instead of showing a message.

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
generation_errors   -- id, occurred_at, stage, category, scenario_id, variant_id,
                    -- level, message, context jsonb — see below
```

`tokens` must reconstruct the full line when concatenated in order — it's what makes the post-answer "tap any word" reveal possible. Hand-authored rows from the LLM-free phase only tokenized notable vocabulary, not the whole sentence; the reveal UI checks reconstruction and falls back to plain (non-tappable) text for those rows rather than rendering a sentence with gaps.

**Cache strategy:** hand-authored rows and live-generated rows share one pool per `(scenario, variant, level)` — `prompt_version`/`model` are provenance metadata (which generation era wrote this row), not a partition key, so `getDialogue`'s pool lookup doesn't filter on them. Picks uniformly at random across whatever's pooled for replay variety; tops up in the background (fire-and-forget, not awaited) when the pool for a key drops below 2.

**What's still true from the LLM-free phase, worth keeping in mind:** the rule-based fallback's paraphrase tolerance is narrower than the LLM path's — this only shows up when Gemini grading is actually down, which should be rare. Debriefs are still not LLM-written prose; the done screen is a plain score tally + full script recap (matches the cloned reference — see requirements.md §3).

**Pre-seeding the pool without spending Gemini calls.** `scripts/seed-content/` is a small reusable pipeline for hand-authoring pool content directly — no live API call at all, so it costs nothing against the free-tier quota above. `scripts/seed-content/data/*.json` holds one file per `(scenario, level)` batch, each an array of dialogue objects (`scenario_slug`, `variant_id`, `level`, `setting`, `lines[]` — same shape `generateAndStore` produces). `scripts/seed-content/build-sql.mjs` validates each one (6-8 lines, speakers alternate starting with `a`, every required field present, and — the check that matters most — each line's `tokens[].ja` concatenate to reconstruct that line's `ja` exactly) and emits ready-to-run SQL that inserts through the same `generated_dialogues`/`generated_lines` tables, tagged `model: 'claude-authored'` so it's identifiable in the data but still shares the pool with Gemini-generated rows (not a partition key, per above). Used once already to seed all 35 active variants across all 7 scenarios at 子供 (kodomo, the default level for new users) — every scenario/variant a new learner can land on now has pooled content before they ever hit "Start listening," with live generation only kicking in for other levels or for pool top-ups. To add more: write a new data file in the same shape, run `node scripts/seed-content/build-sql.mjs path/to/file.json`, and apply the printed SQL.

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
           -- hints_used smallint, note, latency_ms, answered_at
lookups    -- id, session_id, user_id, token_ja, kana, romaji, en, looked_up_at
```

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

Two requirements are in tension: *"don't replay completed scenarios"* and *"generate fresh dialogue every run so it never repeats."* Since dialogue is generated live again (§2.3 — a pool miss triggers a real Gemini call), a scenario is never truly exhausted in practice: completing every pooled dialogue for a `(scenario, variant, level)` just means the next play generates a new one rather than reusing an old one. This wasn't true during the LLM-free phase (fixed hand-authored bank, genuinely finite) — worth remembering if Content Generation ever goes LLM-free again.

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
| Dialogue pool empty for a key AND live Gemini generation fails | `getDialogue` throws — no second fallback for generation itself (unlike grading, which has one). Rare in practice since a pool miss is the common case and just triggers a live call; this only bites if Gemini is down *and* nothing's pooled yet for that `(scenario, variant, level)`. Every such failure is categorized (§2.3) and written to `generation_errors` before rethrowing, so it's queryable afterward even though the learner just sees the generic "couldn't build the dialogue" message (`useStartSession`, above). |
| Gemini grading call fails | Falls back to rule-based word-overlap grading in-process (§2.3) — nothing external to go down on that path. Also logged to `generation_errors` (stage `grading`) before falling back. |
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
