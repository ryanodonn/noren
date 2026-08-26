# Noren — Requirements

> No separate requirements/PRD doc existed before this — only [`services.md`](./services.md), which is architecture, not product scope. This doc is synthesized from that architecture, the Noren concept, and this project's kickoff conversation. Everything under **Assumptions to confirm** at the bottom is a guess, not a decision — correct it before it hardens into code.

---

## 1. Concept

**Noren** (暖簾) — the split curtain hanging in a shop doorway. You push through it to enter.

Every scenario in the app is walking into a place and talking to whoever's inside: a konbini clerk, an izakaya owner, a train station attendant. The metaphor is exact, not decorative — it's the whole interaction model. You don't pick a "lesson." You push through a curtain and someone starts talking to you.

## 2. Problem

Japanese learners plateau at the same wall: they know grammar and vocabulary from textbooks or apps like Anki/Duolingo, but freeze in an actual exchange — because reading a flashcard and holding a real-time conversation are different skills, and most tools only train the first one.

Noren trains the second one: bounded, low-stakes, repeatable conversations with a clear goal ("buy a rice ball and decline a bag"), immediate correction, and vocabulary review that's driven by what you personally got wrong — not a generic frequency list.

## 3. Core loop

1. **Choose a scenario** at your current level (or one offered) — e.g. konbini, izakaya — each with a stated goal, setting, and opener.
2. **Enter** — a pre-authored dialogue plays out turn by turn (see §6 — not live-generated in v1). You respond by typing (JA or EN toggle) or speaking (STT).
3. **Each line is graded** — `got_it` / `close` / `missed` — with hints available and tracked (a hinted correct answer is not a cold correct answer).
4. **Session completes** when the dialogue ends, regardless of score — completion means "you did this," not "you passed."
5. **Debrief** — a short templated review of the session.
6. **Vocabulary harvest** — missed words and looked-up words become spaced-repetition flashcards, weighted by how they were encountered.
7. **Progression** — every ~30 attempts, the app may suggest leveling up or down, as an offer the learner accepts or dismisses, never automatic.

## 4. Modes

| Mode | Depends on | Description |
|---|---|---|
| **Conversation** | Content Generation (authored bank, v1) | Full pre-authored dialogue, graded turn by turn via rule-based matching. The primary mode. |
| **Listening** | Speech (browser TTS) only | Audio-first practice against the same authored dialogues. |
| **Flashcards** | Vocabulary (SRS) | A distinct UI surface, not a drill variant — audio-first recall, reveal shows the original sentence the word was missed in. |

## 5. Level system

The doc names two levels so far: **子供** (kodomo) and **小学生** (shougakusei) — read as developmental-stage framing rather than "beginner/intermediate" labels. *(See open question below — the full ladder above these two isn't specified yet.)*

- A scenario is scoped per `(scenario × variant × level)`. The same scenario at a harder level is a different completable unit, correctly so — the situation repeats, the language gets harder.
- Progression is a suggestion, never automatic, and requires breadth (≥2 distinct scenarios) so a learner can't promote by memorizing one script.
- Demotion is framed as an offer ("want to drop back to 子供 for a bit?"), never presented as a demotion.

## 6. Content model

- Scenarios are authored (where/who/goal/opener/persona), and variants are data (DB rows), not code.
- **v1 decision (see services.md §2.3 for the full reasoning): no live LLM.** Dialogue was originally meant to be generated per playthrough so a scenario is never truly exhausted. Running that live means a real API key and real ongoing cost just to operate the app, so v1 ships with a **fixed, hand-authored dialogue bank** per `(scenario, variant, level)` instead — authored directly (by a person or an AI assistant during a build session), not generated at runtime. Grading is rule-based fuzzy-matching against authored acceptable-answer sets, not an LLM judging paraphrases; debriefs are templated, not written. Consequence: a scenario *can* now be exhausted if a learner outpaces the authored content for a key — the mitigation is authoring more, same as adding a variant.
- A scenario is marked complete-with-replay once all its variants are done at a level; never hard-hidden. Replayed sessions are flagged so they don't distort progression stats.
- Growing the catalog (new variants, new dialogues) is now a direct authoring task rather than an automated propose-then-review pipeline — same effect, manual instead of LLM-assisted for now.

## 7. Non-goals (v1)

- No multiplayer / talking to other learners.
- No user-authored scenarios (content is authored by the team, not open authoring).
- No live LLM dependency in v1 (see §6) — a deliberate cost/simplicity trade, not an oversight. Revisit if paraphrase-tolerant grading or infinite dialogue variety becomes worth the ongoing API cost.
- No microservices — see [`services.md`](./services.md) §0: modular monolith until a concrete trigger (independent scaling, different runtime, third-party consumption) forces extraction.
- No speculative event-bus / message-queue infrastructure — direct function calls within the monolith until a module is actually extracted (`services.md` §4).

## 8. Assumptions to confirm

These aren't in the source doc — flagging so they get an explicit yes/no rather than quietly becoming load-bearing:

- **Audience:** self-directed adult learner of Japanese, not a classroom/institutional product. Confirm?
- **Platform:** web app (Next.js), not native mobile, for v1.
- **Monetization:** none specified — free, subscription, one-time? Affects whether usage limits (LLM cost) need to exist in v1.
- **Full level ladder:** only 子供 and 小学生 are named. Is there a level above 小学生 planned (中学生, 高校生, 大人), or is a two-level ladder the actual v1 scope?
- **Script preference:** Identity owns a "script preference" (kana/romaji/kanji mix?) — the exact options and default aren't specified.

~~**Cost ceiling:** Content Generation is LLM-bound per session; no stated budget or rate-limit per user.~~ Resolved 2026-08-25 — v1 has no live LLM at all (§6), so this doesn't apply until/unless generation comes back.
