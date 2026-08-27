# Noren — Requirements

> No separate requirements/PRD doc existed before this — only [`services.md`](./services.md), which is architecture, not product scope. This doc is synthesized from that architecture, the Noren concept, and this project's kickoff conversation. Everything under **Assumptions to confirm** at the bottom is a guess, not a decision — correct it before it hardens into code.

---

## 1. Concept

**Noren** (暖簾) — the split curtain hanging in a shop doorway. You push through it to enter.

Every scenario in the app is walking into a place where two other people are already talking: a konbini clerk checking out a customer, an izakaya owner and a regular, a train station attendant and a lost traveler. **You are never one of them.** You're the person who just walked in and is listening — the app's job is to test whether you actually followed what they said, line by line, not whether you can produce a scripted reply yourself. (This corrected an earlier wrong assumption in this doc — see §3.)

## 2. Problem

Japanese learners plateau at the same wall: they can read a textbook dialogue or a flashcard deck, but a real exchange between two native speakers moves too fast and too naturally to actually follow — different vocabulary in isolation is a different skill from parsing it in a live, colloquial exchange, and most tools only train the first one.

Noren trains the second one: bounded, low-stakes overheard conversations with a clear listening objective ("catch what the customer orders, whether they want it heated, and how they pay"), immediate per-line feedback on your translation, and vocabulary review that's driven by what you personally missed — not a generic frequency list.

## 3. Core loop

1. **Pick a level and a scene** on one combined screen — e.g. 子供 level, konbini — no separate briefing step; the scene's listening objective is implicit in picking it, not a page you read first.
2. **Listen** — a dialogue between two other people plays out, line by line, generated fresh (§6). Nothing is shown before you answer except who's currently speaking — no transcript, no translation. For **every line, from either speaker**, you type or speak its English translation from listening alone.
3. **Each line is graded** on translation accuracy — `got_it` / `close` / `missed` — with hints available and tracked (a hinted correct answer is not a cold correct answer). Hints never reveal the translation, only build toward it (a word gloss, then the full Japanese reading) — you still have to translate it yourself.
4. **Session completes** when the dialogue ends, regardless of score — completion means "you followed it," not "you got every line." A learner can also skip a line outright ("I don't know — show me"), which counts as missed without spending a grading call.
5. **Done screen** — a score tally plus the full script (every line, replayable, with its translation) — not written prose.
6. **Vocabulary harvest** — missed and looked-up words become spaced-repetition flashcards, weighted by how they were encountered.
7. **Progression** — every ~30 attempts, the app may suggest leveling up or down, as an offer the learner accepts or dismisses, never automatic.

## 4. Modes

| Mode | Depends on | Description |
|---|---|---|
| **Conversation** | Content Generation (Gemini + pool cache) | Every line of a two-person dialogue, translated and graded. The primary mode. |
| **Listening** | Speech (browser TTS) only | Audio-first practice against the same pooled dialogues. |
| **Flashcards** | Vocabulary (SRS) | A distinct UI surface, not a drill variant — audio-first recall, reveal shows the original sentence the word was missed in. |

## 5. Level system

Six levels, from a cloned reference design (see §9): **幼児** (yoji/Toddler) → **子供** (kodomo/Child) → **小学生** (shogaku/Grade school) → **入門** (nyumon/Pre-N5) → **N5** (JLPT N5) → **N4** (JLPT N4). Each level pairs a grammar/vocabulary constraint (fed into the generation prompt) with a TTS playback rate that increases with level (0.65× → 1.05×) — higher levels sound faster and more natural, not just harder in content.

- A scenario is scoped per `(scenario × variant × level)`. The same scenario at a harder level is a different completable unit, correctly so — the situation repeats, the language gets harder.
- Progression is a suggestion, never automatic, and requires breadth (≥2 distinct scenarios) so a learner can't promote by memorizing one script.
- Demotion is framed as an offer ("want to drop back to 子供 for a bit?"), never presented as a demotion.
- The level picker is a free per-session choice (defaults to the Progression-tracked level, but nothing stops picking a different one for a single run) — Progression evaluates whatever level a session actually happened at, it doesn't gate which levels are selectable.

## 6. Content model

- **Live generation, with a rule-based fallback — not an all-or-nothing decision, and this reversed once already.** Content Generation was originally meant to call an LLM live. It went LLM-free for a build pass (hand-authored dialogue bank, rule-based grading) because running a real API key for a pre-launch app with no users felt like premature cost. Then the actual target — 7 scenarios × 6 levels of dialogue that's fresh every time, cloned from a reference the user built — made hand-authoring hundreds of combinations impractical, so live generation came back via **Gemini** (free tier, not Anthropic) rather than reverting the whole decision. The rule-based grader from the LLM-free phase became the **fallback** when a live grading call fails, not dead code. Full history and the mechanics: `services.md` §2.3.
- **Grading direction:** the learner always translates Japanese → English (§1, §3) — there is no Japanese-production mode. This was also a correction — the app originally had the learner producing Japanese as a scripted participant, which was the wrong mechanic entirely (§1).
- Scenarios and variants are authored data (DB rows), not code — no separate briefing content (where/who/goal/opener text) exists anymore; a scenario record is just its name, role labels, and a category badge, plus variant seed strings fed to the generator.
- A scenario is never truly exhausted (live generation, §2.3) and is never hard-hidden; replay happens transparently through the same "Start listening" flow, flagged internally so it doesn't distort progression stats.

## 7. Non-goals (v1)

- No multiplayer / talking to other learners.
- No user-authored scenarios (content is authored by the team or generated, not open authoring).
- No microservices — see [`services.md`](./services.md) §0: modular monolith until a concrete trigger (independent scaling, different runtime, third-party consumption) forces extraction.
- No speculative event-bus / message-queue infrastructure — direct function calls within the monolith until a module is actually extracted (`services.md` §4).
- No paid STT/TTS vendor — browser Web Speech API only (`services.md` §2.4). Unlike the LLM decision, this one hasn't been revisited; nothing in scope has forced it yet.

## 8. Visual identity

Cloned deliberately from a reference the user built (see §9): dark-only "field notebook" aesthetic — near-black background, a single amber accent color for CTAs/selection state, Barlow Condensed for UI chrome, Zen Kaku Gothic New for Japanese text, hairline 1px grid-line dividers between list rows, uppercase letter-spaced micro-labels, sharp corners throughout. Not a light/dark-adaptive theme — one committed look.

## 9. Assumptions to confirm

These aren't in an original source doc — flagging so they get an explicit yes/no rather than quietly becoming load-bearing:

- **Audience:** self-directed adult learner of Japanese, not a classroom/institutional product. Confirm?
- **Platform:** web app (Next.js), not native mobile, for v1.
- **Monetization:** none specified — free, subscription, one-time? Affects whether usage limits (LLM cost) need to exist, though Gemini's free tier makes this less urgent than it would be otherwise.
- **Script preference:** Identity owns a "script preference" (kana/romaji/kanji mix?) — the exact options and default aren't specified.

~~**Full level ladder:** only 子供 and 小学生 were named.~~ Resolved — six levels, cloned from the reference design (§5).

~~**Cost ceiling:** Content Generation is LLM-bound per session; no stated budget or rate-limit per user.~~ Live again via Gemini's free tier (§6) — genuinely low-stakes at current scale, but worth revisiting if usage ever grows past what the free tier covers.
