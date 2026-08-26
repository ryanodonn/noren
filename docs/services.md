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
GET  /scenarios/{id}/briefing
POST /scenarios/{id}/reset             → explicit user request to replay
```

**Owns tables**
```sql
scenarios          -- id, slug, name_ja, name_en, line_label, speaker_a, speaker_b,
                   -- where_text, who_text, goal_text, opener_text, persona_prompt
scenario_variants  -- id, scenario_id, description, active
seed_phrases       -- id, scenario_id, ja, romaji, en
scenario_completion-- user_id, scenario_id, variant_id, level, completed_at,
                   -- score, PRIMARY KEY (user_id, variant_id, level)
```

**The learner is never `speaker_a`/`speaker_b`.** Both are other people (e.g. `speaker_a = "Customer"`, `speaker_b = "Clerk"`) — the learner eavesdrops and translates every line, both speakers, into English (see §2.3). `who_text`/`goal_text` are written as a listening objective ("catch every line — what does X order, does Y need a bag..."), not as instructions to a participant. This wasn't the original design — see requirements.md §1 for how that got corrected.

**Called by:** Session & Attempt, on session completion (`markScenarioCompletion`).

**Extraction note:** the completion table is the only part that's user-scoped. If Catalog is ever extracted, completion may be better placed with Session — evaluate at extraction time.

---

### 2.3 Content Generation
**Owns:** dialogue content, grading, debriefs — **no live LLM in v1.**

**v1 pivot (deliberate, revisit before scaling content authoring):** this context was originally an LLM-bound wrapper around Claude — generate on demand, cache the result. In practice that meant a real per-app API key and real ongoing cost just to run a demo. v1 instead ships as a **fixed, hand-authored content bank**: dialogues are written once (by a person, or by an AI assistant during a build session — not by a runtime API call) and inserted directly into the pool tables below. Grading, hints, and debriefs are rule-based, not generated. This is a real trade — see "What v1 gives up," below — not a free simplification.

**Surface (in-process, per §4 — not literal HTTP)**
```
getDialogue(scenario, variant, level)     → a pooled dialogue, picked at random
grade(lineId, userAnswer)                 → verdict + note, via fuzzy match against authored acceptable answers
getHint(lineId, hintsUsedSoFar)           → a static, graduated hint built from the line's own fields
getDebrief(summary, missedLines)         → templated review text
```

**The direction is translation, not production.** The learner is never one of the two speakers (§2.2) — every line, both speakers, gets played/shown in Japanese, and the learner types (or speaks) its English translation. Every line is graded; there's no passive/interactive split by speaker.

**Grading, concretely:** every line carries `acceptable_en` — a small authored array of English phrasings that count as correct alongside the line's own `en` field, written alongside the dialogue itself. Grading scores the learner's answer against `[en, ...acceptable_en]` using **word-overlap (Dice coefficient) similarity**, not character-level edit distance — English translations vary in word order and length far more than the old production-direction Japanese answer sets did, and edit distance would score legitimate paraphrases as wildly different. Near-exact word-set match → `got_it`, partial overlap → `close`, otherwise → `missed`. Pure functions, no I/O — see `src/modules/content-generation/grading.ts` and its tests.

**Hints, concretely:** no generation — hint depth 0 shows the single hardest word's gloss (`key_ja`/`key_en`), depth 1 shows the fuller `gist` context clue, depth 2+ shows the full `en` translation. (Depth 0 can't lead with `gist` — it was authored as a near-paraphrase of the line, which would hand over the answer immediately.)

**Owns tables**
```sql
generated_dialogues -- id, scenario_id, variant_id, level, setting, prompt_version,
                    -- created_at, model  ('model' = 'authored' in v1, not a real model id)
generated_lines     -- id, dialogue_id, seq, speaker, ja, kana, romaji, en,
                    -- gist, key_ja, key_romaji, key_en, tokens jsonb, audio_url,
                    -- acceptable_en jsonb
```

**Cache strategy, revised:** the "pool" is now the entire authored bank for a `(scenario, variant, level, prompt_version)` key — `getDialogue` picks uniformly at random across it for replay variety. There is no background top-up, because there is no generation to top up with. Growing the pool means authoring more dialogues for a key, same as adding a scenario or variant — a data operation, not a deploy (§3).

**What v1 gives up, honestly:**
- **Paraphrase tolerance is weaker than the production-direction version was.** Word overlap tolerates reordering and filler-word differences, but a same-meaning-different-words answer ("heat it up" vs. the authored "warm this please") shares no words and scores as `missed` even though it's correct. Mitigated by authoring several `acceptable_en` phrasings per line — but it's still a narrower net than an LLM grader would cast.
- **"Never truly exhausted" (§3) no longer holds as stated.** With a fixed bank instead of infinite generation, a learner *can* run out of authored dialogues for a `(scenario × variant × level)` combination. Mitigation is the same as growing the catalog itself: author more content for that key.
- **Debriefs are templated, not written.** Accurate, not personalized prose.

**If live generation is added back later** (a real LLM key becomes acceptable, or as an opt-in upgrade): keep it behind this same module interface — `getDialogue`/`grade`/`getHint`/`getDebrief` — so callers never know which mode is active. `prompt_version`/`model` already distinguish authored rows (`'authored-v2'` / `'authored'`) from anything a future generator would write, so the two can coexist in the same pool without a migration.

---

### 2.4 Speech
**Owns:** STT and TTS. The only context touching audio.

**v1: browser-native only, no server surface.** Same reasoning as Content Generation's v1 pivot — a paid STT/TTS vendor is another API key and another ongoing cost for a context whose only job in v1 is "make sound." Implemented as a client-side hook (`src/modules/speech/useSpeech.ts`) over the Web Speech API: `SpeechSynthesis` for TTS, `SpeechRecognition` for STT. Zero cost, zero keys, works today — at the cost of being genuinely browser-dependent (`SpeechRecognition` doesn't exist in Firefox, and is unreliable in Safari) and lower voice quality than a real vendor.

**Interface, concretely**
```
speak(text, { voiceName?, rate?, lang? })  → plays audio via SpeechSynthesis
listen({ lang? })                          → Promise<string>, via SpeechRecognition
```

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

Two requirements are in tension: *"don't replay completed scenarios"* and *"generate fresh dialogue every run so it never repeats."* If dialogue is procedurally generated, a scenario is never truly exhausted.

**v1 caveat:** dialogue is currently a fixed, hand-authored bank per `(scenario, variant, level)`, not live generation (§2.3) — so "never truly exhausted" is the target this design is built for, not a v1 guarantee. A learner who plays every authored dialogue for a variant/level *will* start seeing repeats. The granularity below still does its job (completion tracking, replay flagging); it's the supply of fresh dialogue behind it that's currently finite.

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

**Never hard-hide content.** A learner who wants to redo the izakaya should be able to. Replay is explicit (`POST /scenarios/{id}/reset`), and replayed sessions are flagged so they don't distort progression statistics.

### Variant supply

Five variants per scenario will exhaust faster than expected. Two mitigations:
1. Variants are **data, not code** — adding one is a database row, not a deploy.
2. New dialogues (and new variants) are authored directly against the existing set — in v1 that's a person (or an AI assistant, during a build/content session) writing rows into `generated_dialogues`/`generated_lines`, not a runtime pipeline. If live generation is reintroduced later (§2.3), this becomes "propose, then review before activation" again.

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
| Dialogue pool empty for a key | `getDialogue` throws — there's no live fallback generation in v1. Fix is authoring more content for that `(scenario, variant, level)`, not a runtime recovery path. |
| Grading/hint/debrief | Rule-based, in-process — nothing external to go down. (If live LLM generation is reintroduced per §2.3: same principle as below — reveal the answer with a note, record `verdict = null`, Progression ignores null verdicts.) |
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
