---
name: tiered-development
description: Use when tackling a non-trivial feature, refactor, or design problem and you want the work delegated across model tiers instead of done inline — "design and build X", "plan then implement Y the tiered way", "delegate this properly". You (the Opus coordinator) draft a rough plan WITH the user via brainstorming, hand it to design-panel — a cheap Sonnet composer picks the Opus/Fable architect(s) by default, and you override only when the user asks — to refine into a waved plan, pause for the user's approval, then run each wave through the execute-wave workflow — fresh Opus builders for substantive steps, Sonnet for mechanical, Haiku for menial, each in its own git worktree — and close with a deep review (review-panel). NOT for trivial one-line edits (just do those) or whole-repo review (use full-project-review).
---

# Tiered Development

## Overview

Deliberate delegation so each model tier does what it is best at, with you (the
Opus coordinator) orchestrating and the user in the loop at the one gate that
matters.

- **Fable** (`tiered-development:architect`, `tiered-development:deep-reviewer`) —
  the strongest tier. It now **bills extra per use**, so spend it **sparingly** and by
  the right criterion: not "hard design decisions" but **complexity and impact** — the
  core of a hard algorithm, deep analysis of a large/existing codebase, hunting subtle
  long-standing bugs, or tracing the blast radius of a decision. The plan/verdict
  integrator escalates from Opus to Fable when the panel reports HIGH difficulty —
  not merely because a panellist used Fable.
- **Opus** — three uses:
  - **You, the coordinator** — orchestration only: brainstorm with the user,
    route work, keep them in the loop, decide between tiers. Keep your own context
    lean; do NOT implement inline. Do NOT run builds/tests/lints or grep/read
    source files to check a worker's output either — the per-wave verifier
    verifies each step and the review-panel is the whole-change gate, so react to
    their structured verdicts instead of re-checking yourself. If you genuinely
    need to know something about the code, dispatch a `tiered-development:reader`
    rather than reading it directly; reading code or running checks inline burns
    your context and duplicates the workforce's job. The only commands you run are
    orchestration: probing `git rev-parse --is-inside-work-tree` for `isGit` and
    `git rev-parse HEAD` for a wave's `baseRef`, and the final integration
    commit/push. The one file you read directly is `GUIDELINES.md` (step 0) — you
    forward it verbatim rather than reason about it, so it costs you nothing to hold.
  - **`tiered-development:builder` (Opus)** — the primary implementer, launched
    fresh per substantive step so each gets a clean, focused context.
  - **Default thinking tier** for `architect` / `deep-reviewer`, and the **default
    for the plan/verdict integrator** — which escalates to Fable only on HIGH
    panel-reported difficulty. Both are fully overridable, including an explicit
    Sonnet integrator; left to its own defaults, the integrator never drops below
    Opus on its own. A stuck integrator follows the same escalation ladder as any
    stuck worker — Sonnet → Opus → Fable (see ## Escalation rule).
- **Sonnet** (`tiered-development:reader`, `tiered-development:implementer`,
  `tiered-development:verifier`) — the workforce: read-only research, mechanical
  edits, the per-wave integrator/verifier (which merges the wave's branches back,
  resolving conflicts in place, verifies, and squashes a green wave into one
  commit), and the mandatory **composer** (which groups the wave's steps into
  workers and tiers each). Also an **admissible panel model** — the composer may
  auto-assign Sonnet to light lenses/aspects on design-panel/review-panel — but
  never an auto-default integrator; the integrator only goes to Sonnet by explicit
  override.
- **Haiku** — the floor for genuinely menial work: `implementer` on menial steps
  and cheap `reader` lookups.

**Selection principle — how to pick a tier.** Pick the cheapest tier that will
reliably get it right, weighing the judgement the step needs against the cost of a
wrong result (subtle, hard-to-catch, wide blast radius). Menial, obvious-if-wrong
edit → Haiku. Routine mechanical work → Sonnet. Judgement, or an expensive silent
error → Opus. Fable only for high-complexity or high-impact work (deep bug-hunts in
existing code, blast-radius analysis), since it bills extra. Err upward when a
mistake would be costly. You *may* set tiers explicitly, or omit them and let a cheap
Sonnet composer decide.

**Why delegate instead of doing it yourself:** every implementation task goes to a
freshly-spawned agent with only the context that task needs. That focus — not the
coordinator juggling the whole job in one crowded context — is what raises code
quality. Your job is to slice the work cleanly and route each slice to the right
tier.

You drive this. The phases with real fan-out are extracted into small workflows
you **call** — `tiered-development:design-panel` (refine the plan),
`tiered-development:execute-wave` (build one wave), and
`tiered-development:review-panel` (final deep review) — because a script runs their
parallelism better than you can by hand. Always invoke them by these
fully-qualified names; the bare `design-panel` / `execute-wave` / `review-panel` do
not resolve. Everything else — the brainstorm, the approval gate, routing,
escalation — stays here, with you.

**Namespacing (required).** Every agent and workflow shipped by this plugin is
registered under the `tiered-development:` prefix. Whenever you dispatch one — as
a `subagent_type` for the `Agent` tool, or a `name` for `Workflow`/`Skill` — use
the fully-qualified name (`tiered-development:architect`,
`tiered-development:deep-reviewer`, `tiered-development:reader`,
`tiered-development:execute-wave`, …). The bare name is **not found** and the
dispatch fails.

## The protocol

### 0. Load the project's guidelines — once, at the start

Read `GUIDELINES.md` at the repository root if it exists (one `Read`; this is the
one file you read directly rather than via a `reader`, because you forward it
rather than reason about it). It holds the project's **standing rules** — global
requirements, conventions, practices that hold for every task in this repo — so
that you never have to restate them per worker. Pass its contents **verbatim** as
the `guidelines` argument to `design-panel`, every `execute-wave`, and
`review-panel`; each workflow injects them into every architect, worker,
integrator and reviewer it spawns. Do not paraphrase, trim, or "apply" them
yourself — forwarding the file *is* the mechanism.

If the file does not exist, omit the argument and carry on. When the user states
a standing rule mid-session ("always do X in this project"), offer to add it to
that file so it survives into later sessions; a rule that only applies to the
task at hand belongs in the step's own instructions instead. See
`project-guidelines.md` next to this file for the format and what belongs there.

**A guideline is a hard requirement.** Agents are told they may not decide to break
one: if a task cannot be done without violating a guideline, they STOP and return a
`BLOCKER` naming it. **You cannot authorise that yourself** — this is the one
escalation you never resolve on your own context, however obvious the answer looks.
Take it to the user with the agent's justification intact (the guideline, the exact
conflict, why there is no compliant route, what the agent would do if authorised),
and only continue once they have decided. If they authorise it, say so explicitly in
the re-dispatched step's instructions; if the guideline is simply wrong, the fix is
to change `GUIDELINES.md`, not to wave the step through.

### 1. Brainstorm a rough plan — WITH the user

Draft the approach and a rough set of steps *together with the user*. Use
`superpowers:brainstorming` to drive the dialogue, and dispatch
`tiered-development:reader` (Sonnet) agents to ground the discussion in what the code actually does before you commit
to an approach. The output of this phase is a **rough plan**: the chosen approach
plus a rough list of steps. It does not need to be dispatchable yet — the
architect(s) refine it next. Getting the user's intent right here is what the whole
pipeline depends on.

### 2. Refine the rough plan — via `tiered-development:design-panel`

Hand the rough plan to the architect(s) to turn into a concrete, dispatchable,
wave-grouped plan. **Call `EnterPlanMode` as/when you dispatch design-panel** —
dispatching the read-only design-panel workflow is planning work and is permitted
under plan mode, so entering it here makes the step-3 approval gate
harness-enforced (no edit can slip through before the user says go):

```
Workflow({ name: "tiered-development:design-panel", args: { level, task, roughPlan, guidelines, panelModels, integratorModel } })
```

- `level` is `quick` | `standard` | `deep` — sets the plan's step budget. Scale it to the task.
- `task` is the task description; `roughPlan` is what you and the user drafted in step 1.
- **`panelModels`** (optional override) — a 1–5 array of `"opus"`/`"fable"`/`"sonnet"`,
  one architect each: `["opus"]` a single Opus refine, `["opus","opus","opus"]` an
  Opus panel, `["fable","opus","fable"]` a mixed panel, `["opus","sonnet"]` an Opus
  panel with a light aspect on Sonnet. On a multi-member panel the architects
  **divide the labour by aspect** (correctness, architecture, decomposition,
  verification, risk) — each owns one, with the whole plan for context — rather than
  each redundantly re-refining everything.
- **`integratorModel`** (optional, `"opus"`|`"fable"`|`"sonnet"`) — the model that
  merges the aspect-refined plans into the final one. No longer composer-returned:
  it **defaults to Opus** and **escalates to Fable** only when the panel reports HIGH
  difficulty; set it explicitly — including an explicit Sonnet integrator — to
  override either default. The two-tier pattern — an Opus panel then a Fable
  integrator (`panelModels:["opus","opus","opus"], integratorModel:"fable"`) — puts
  Fable on the *final* design only.
- **Prefer omitting both** — a cheap Sonnet composer picks the panel composition
  (Opus-leaning, Sonnet for light aspects, Fable only for high complexity/impact),
  and the integrator applies its own Opus-default/Fable-escalation. This is the
  default path; set them explicitly only when the user asks for a specific panel or
  integrator.

It returns `{ design, plan, waves, greenBar }` — `design` is `{ recommendation,
rationale, risks }`; `plan` is an array of steps, each `{ idx, title, files, change,
complexity, wave, role, verify, dependsOn, confidence? }` (complexity ∈ `menial`|`mechanical`|
`substantive`; `role` ∈ `deliverable`|`verify`, where a `verify` step is a wave's closing
format/lint/verify of its own work; `dependsOn` is an array of prerequisite step `idx` values;
`confidence` ∈ `low`|`medium`|`high`, optional). A `low` `confidence` on a step flags a shaky part
of the plan — scrutinise it at the step-3 gate rather than waving it through. Waves are
COMPLETE, GREEN, DELIVERABLE slices — green per the project's own rules, carried in
`greenBar` — and same-wave steps may be dependent and share files, with every
dependency made explicit in `dependsOn`. If `design.risks` carries a QUESTION about
the project's green bar (`greenBar` empty), resolve it with the user at the step-3
gate and supply the answer as `execute-wave`'s `greenBar`. If it returns a `BLOCKER`
instead (the rough plan was contradictory or its premise is wrong), resolve it with
the user before proceeding — this includes a crash-degraded `{ error }`: a
StructuredOutput retry-cap crash in the composer or plan integrator now degrades to
this same `{ error }` return (the crash reason quoted) rather than killing the
Workflow, mirroring the execute-wave crash guidance above; do not treat it as a
pass. A genuine architect BLOCKER now travels through the plan schema's `blocker`
field and likewise surfaces as `{ error }`.

### 3. GATE — the user approves

Present the refined design (recommendation, rationale, risks) and the numbered,
waved plan to the user, then **call `ExitPlanMode`** — the user's response to it
*is* the approval gate. This honours the user's standing "plan before changes"
rule. `ExitPlanMode` must precede step 4, since `execute-wave` makes edits; do not
run a single wave until the user approves. This gate is the reason this skill exists
rather than an autonomous workflow — never skip it.

### 4. Execute — one wave at a time, via `tiered-development:execute-wave`

Probe once whether you are in a git repo (`git rev-parse --is-inside-work-tree`,
directly or via a one-line `tiered-development:reader`). Then, for each wave in
ascending order, **re-probe `git rev-parse HEAD`** to get the current branch tip and
run:

```
Workflow({ name: "tiered-development:execute-wave", args: { task, wave, steps, isGit, totalSteps, baseRef, greenBar, guidelines } })
```

- `steps` is just this wave's steps (filter the plan by `wave`). Each carries a
  three-tier `complexity` (`menial`→Haiku / `mechanical`→Sonnet / `substantive`→Opus).
  **Leave a step's `complexity` blank to let the composer pick its tier**; a
  *garbage* value is refused loudly (fix it), but absence just means "you decide".
  The mandatory Sonnet composer **owns dispatch**: it declares an ORDERED list of
  **batches** of **parallel jobs** — each job one worker doing one or more steps
  sequentially in one worktree; jobs in a batch run in parallel **even when they share
  a file** (the integrator reconciles), and batches run in sequence, each dispatched
  onto the prior batch's integrated tip. A step's `dependsOn` is **advisory** input the
  composer may override; an explicit `complexity` is still a **floor**, never downgraded.
  It prefers **few workers**: sequential dependents that do not build on a parallel
  fan-out merge into one worker (mixing tiers freely — the merged job's tier is the
  **max floor** of its steps), and a later batch starts **only** to build on a prior
  batch's integrated parallel fan-out.
- **Batches are carried forward off your working branch.** A batch of a *single* job
  needs no integration at all — that job's commit already *is* the batch's result, so
  its sha becomes the next batch's base directly and no integrator is spawned. A batch
  that fanned out to two or more jobs gets a Sonnet integrator that merges them **in
  its own worktree**. Your working branch is therefore untouched for the whole wave
  until the final integrate-and-verify pass lands it in one squashed commit. A step's `role: "verify"` is an **advisory
  hint**: the composer may **relay** such a wave-closing verify/format/lint step to
  the final integrate-and-verify gate — which performs it against the *integrated*
  tree and returns its verdict — instead of dispatching it to a worker (a worker's
  isolated worktree can't format the integrated tree); the composer has the final
  word and builds it as a normal step if it actually produces product code. The gate
  performs a relayed step **last** — after verifying every built step and diffing
  against the worker branches, immediately before the squash — and skips it entirely
  when the wave is already not green, so a formatter never leaves rewritten-but-
  uncommitted files in your tree.
- Each worker runs a **scoped self-check before it commits** — it compiles, the tests
  covering its slice pass, its code is formatted. That is deliberately *minimal*, not
  verification: the integrate-and-verify gate still owns the full `greenBar`, the
  cross-step interactions and the adversarial checking. A worker whose slice does **not**
  stand alone commits anyway and **declares** it with a `RED-COMMIT:` marker giving why
  it is red and the expected resolution — what makes it green and where that comes from.
  The reasons are open-ended; what is required is the account, not a category. Two reds
  are never a worker's to fix and are declared rather than repaired: a check already red
  on `baseRef`, and one that cannot run inside an isolated worktree at all. The gate then
  checks the declaration against reality on the integrated tree, so every red it meets is
  either explained and confirmed resolved, or a real problem — never unexplained. A
  resolution a worker defers **beyond** this wave means the wave cannot close green, and
  the verifier says so — treat that as a signal to re-plan the wave boundary, not as a
  broken step.
- `isGit` is your first probe result; `totalSteps` is the whole plan's step count
  (for nicer labels).
- `baseRef` is the current `HEAD` sha you just probed. The harness cuts each worker's
  isolation worktree from the repo's **default branch**, not your checked-out branch,
  so the workers reset onto `baseRef` to build on the right foundation. **Re-probe it
  every wave** — the integrator/verifier advances your branch by **one squashed
  commit** each green wave, so passing the fresh tip is what carries the prior waves'
  results into the next one.
- `greenBar` is the project's green-bar command(s) from design-panel (or the user's
  gate answer); the wave's squash is gated on it.

The mandatory Sonnet composer owns dispatch: it declares an ordered list of
**batches** of **parallel jobs** — each job one worker doing one or more steps
sequentially **in its own git worktree** (substantive → Opus
`tiered-development:builder`, mechanical/menial → Sonnet/Haiku
`tiered-development:implementer`); jobs in a batch run in parallel, and each
batch is dispatched onto the prior batch's integrated tip. Then a **single** Sonnet
`tiered-development:verifier` merges the wave's branches back into your working tree
— resolving any conflict in place — checks all the wave's steps against the
integrated tree (one integrator/verifier, not one per step, so it also catches
interactions between them, and it diffs against the kept worktrees to pinpoint
merge-caused faults), and on a **green** wave squashes it into a **single summary
commit**, where green = every step passes AND the project's `greenBar` passes; a
failed wave keeps its per-step commits and worktrees for you to inspect. Worktrees
are used for **every** job in a git repo — even a single sequential
one — so the workers' in-progress, transiently-broken edits never reach your tree
and never flood your language server with false diagnostics. Outside git it falls
back to sequential edits in the shared tree.

`execute-wave` returns `{ wave, results, integration }`. **React between waves —
this is why you call it per wave rather than handing over the whole plan:**

- As you read each wave's `results`, **collect the builder/implementer flags** —
  the assumptions they had to make, local decisions, and explicit "coordinator
  should verify/confirm" notes from their `Report:` returns — not just the
  pass/fail verdicts. Carry them forward; they feed the final review (step 5).
- If a step returns a `BLOCKER` or a question, apply the **## Escalation rule** below.
- If the wave verifier returns `blocked` on a step, it could not determine that
  step's outcome — its QUESTION/BLOCKER is in that step's `problems`. Treat it
  like a `BLOCKER`: the wave was not squashed and its worktrees/per-step commits
  are kept; do **not** spin an auto fix-up for a `blocked` step — answer the
  question yourself only if you genuinely hold the context, otherwise escalate
  to the user (## Escalation rule), and only continue once it is resolved.
  Scanning the wave's `results` for verdict `blocked` is the authoritative
  signal (robust for the non-git path, where `integration` is null).
- If the wave verifier returns `fail` or `needs-changes` on a step (it ran cleanly
  but the result is wrong — not a `BLOCKER`), do **not** advance the wave. Spin a
  targeted fix-up: re-dispatch that one step as its own single-step wave via
  `tiered-development:execute-wave`, escalating its tier (send it to
  `tiered-development:architect` if the fix needs a design decision), and re-verify
  before moving on. **Never do this for a gate step** (`tier` is `gate` — a relayed
  `role: "verify"` step), whatever its verdict: it has no worker to re-dispatch to, and
  sending it back as its own single-step wave either hands a formatter to a worker in an
  isolated worktree — the exact thing the relay exists to prevent — or is refused as a
  wave with nothing to build. If a gate step reports *not performed*, fix the step that
  actually failed. If it reports a real failure (the formatter errored, lint genuinely
  failed), fix the underlying cause and **re-run the whole wave**, whose gate performs it
  again against the fresh integrated tree.
- A worker's `RED-COMMIT:` declaration travels verbatim in that step's `implemented`
  report. The verifier already judges it, but collect these too — several in one wave
  tell you how tightly the plan split a single change across parallel jobs. That is
  legitimate by design, but it is also where integration risk concentrates, so it is
  worth knowing before you plan the next wave.
- If `integration.conflict` is not `none` **or** `integration.failed` is set, stop
  and inspect. The integrator/verifier resolves conflicts in place, so a surfaced
  `conflict` is one it could **not** safely resolve — the wave's steps overlapped in
  a genuinely ambiguous way; re-plan that boundary. `failed` means it returned no
  result and could not confirm the merge — either it returned nothing or it
  crashed outright (e.g. the agent never produced valid structured output and
  hit the retry cap; the workflow degrades that to this wave-level failure
  instead of crashing, quoting the reason in `integration.conflict`) — inspect
  the tree before continuing. On a `fail`/`needs-changes` wave
  the worktrees are left in place on purpose, for you to inspect the original
  branches while spinning the fix-up. (`integration.resolved` lists files where a
  conflict *was* auto-resolved — the verifier scrutinises those, but they don't stop
  the wave.) On a green wave `integration.squashed` is set and `integration.summary`
  holds the one-line message of the single commit the wave was collapsed into. A
  multi-batch wave that aborts mid-batch leaves your working branch **untouched**
  (`integration.merged` is 0): every batch is carried forward off-branch and only the
  final integrate-and-verify pass lands the wave, so there is nothing to unwind —
  inspect what `integration.conflict`/`failed` reports and re-run the wave.
- If a step you routed to Sonnet turns out to need judgement, re-route it to a
  `tiered-development:builder` rather than accepting a guessed result.

Only move to the next wave once the current one is integrated and clean, so the
next wave sees the settled result.

### 5. Final deep review

Once the whole change is assembled, run the cross-cutting review the per-wave
verifiers cannot (especially interactions between steps built in isolation), then
relay the verdict to the user. **Forward the builder/implementer flags you
collected in step 4** into the review's context — fold them into the
`review-panel` `changed` argument (or the inline `deep-reviewer` prompt) — so the
reviewer scrutinises exactly the spots the workers were uncertain about instead of
having to rediscover them. Two ways, scale to the change:

- **Deep / high-stakes** — `tiered-development:review-panel`, mirroring design-panel:

  ```
  Workflow({ name: "tiered-development:review-panel", args: { level, task, design, changed, files, guidelines, reviewModels, integratorModel } })
  ```

  `reviewModels` (1–5 of `"opus"`/`"fable"`/`"sonnet"`) fans out reviewers on distinct
  lenses; `integratorModel` (`"opus"`|`"fable"`|`"sonnet"`) merges them into one
  verdict (most severe wins) — no longer composer-returned: it **defaults to Opus**
  and **escalates to Fable** only when the panel reports HIGH difficulty; set it
  explicitly — including an explicit Sonnet integrator — to override either default.
  The two-tier pattern (`reviewModels:["opus","opus"], integratorModel:"fable"`) puts
  Fable on the *final* verdict only. Prefer omitting both — the Sonnet composer picks
  the panel composition (Opus-leaning, Sonnet for light lenses, Fable only for high
  complexity/impact) and the integrator applies its own Opus-default/Fable-escalation;
  set them explicitly only when the user asks for a specific panel or integrator.
  Returns `{ review: { verdict, evidence, problems, blocker } }` — `problems` is now
  an array of `{ point, confidence? }` (`confidence` ∈ `low`|`medium`|`high`,
  optional) — a `low` `confidence` on a point flags a shaky finding, so weight it into
  your final-review focus rather than treating it at face value; `verdict` also has a
  `blocked` value, with the ask-back text in `blocker`; the panel can instead degrade
  to the `{ error }` return described below.
- **Light** — a single `tiered-development:deep-reviewer` inline via the `Agent` tool
  (pick `model: opus`, or `fable` if it warrants the cost). No fan-out, no workflow.

**If the verdict is not `pass`, do not proceed to step 6.** A verdict of `blocked`
means the panel (a reviewer or the integrator) genuinely could not determine the
verdict — its QUESTION/BLOCKER is in `review.blocker` (or a candidate's
`blocker`); treat it like a `BLOCKER`: surface it to the user and do **not**
autonomously loop a fix-up (apply the ## Escalation rule below), answering it
yourself only if you genuinely hold the context, and continue only once resolved.
Separately, if the review-panel integrator **crashes** (a StructuredOutput
retry-cap or a null return), the workflow degrades that to the existing
`{ error }` return (not a verdict), quoting the crash reason — a crashed
reviewer is simply **dropped** from the panel (the review fails only if *all*
reviewers crash); on an `{ error }` return, inspect and re-invoke rather than
treating it as a pass. If you are in doubt about any finding — it may be a false
positive, or rest on harness/project context the reviewer lacked — surface the
findings to the user and let them adjudicate which to fix *before* dispatching any
fix-up; do not autonomously loop back on uncertain findings, since a review can be
wrong and the user often holds context the reviewer does not. Otherwise loop back:
spin a targeted fix-up wave for the flagged steps
(via `tiered-development:execute-wave`, escalating tier as needed), or re-plan via
`tiered-development:design-panel` if the design itself is wrong — then re-review. If
you loop back by re-planning via design-panel (rather than just a fix-up wave),
re-enter plan mode after dispatching it and re-gate via `ExitPlanMode` before
executing the revised plan, exactly as in steps 2–3. Only a `pass` advances to
Integrate.

### 6. Integrate

Handle final integration (commit / PR) under the user's existing git-permission
prompts.

## Communication — keep it token-lean

Every agent you dispatch, and every `agent()` call inside the workflows,
follows `skills/tiered-development/comms-protocol.md`: returns are structured data,
not prose — terse, `path:line`-cited, verbatim on error strings / commands /
verdict keywords / `BLOCKER` / `QUESTION`, and never compressed where a
`BLOCKER`/`QUESTION` explanation or a security caveat needs to be unambiguous. When
you write a prompt for an agent, brief it the same way: say what you need back, not
a restatement of the task.

## Escalation rule

If a Sonnet or Haiku worker returns `BLOCKER`, ambiguous, or a question rather than
a result, resolve it yourself or escalate the step back to
`tiered-development:architect` (Opus, or Fable if it warrants the cost) for a design
decision. Never silently downgrade a judgement call to a cheaper tier by guessing on
the worker's behalf — that defeats the whole arrangement.

## Workspaces: why worktrees

`execute-wave` runs implementation workers in **isolated git worktrees**, not your
working tree, for two reasons:

- **A clean coordinator context.** Because edits happen in a separate checkout,
  your session's language server never sees the workers' in-progress, often
  transiently-broken edits — so you are **not flooded with LSP diagnostics** while
  work is underway. This holds even for a single sequential step, which is why
  worktrees are used whenever the repo is git, not only for parallel waves.
- **Parallelism.** Independent workers run concurrently; jobs in later batches are
  reset onto the integrated tip of the prior batch (`baseRef` still seeds batch 1).

One caveat the harness imposes: an isolation worktree is cut from the repo's
**default branch**, not your checked-out branch. That is why step 4 passes `baseRef`
(your current `HEAD`) into each wave — the workers `git reset --hard` onto it before
working, so a feature branch's foundation (and each prior wave's integrated result)
actually reaches them.

This needs a git repo. See `superpowers:using-git-worktrees` for the mechanics;
without git, `execute-wave` falls back to sequential edits in the shared tree.

## When NOT to use

- Trivial edits (a rename, a one-liner) — just do them inline; the tiering
  overhead is not worth it.
- Reviewing an entire existing codebase — use `full-project-review`.
- A change where the approach is already fully decided and needs no plan — skip
  the brainstorm/refine and go straight to dispatching workers
  (`tiered-development:builder` / `tiered-development:implementer`), still via
  `tiered-development:execute-wave` if you want the worktree isolation.
