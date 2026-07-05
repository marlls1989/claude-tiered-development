---
name: tiered-development
description: Use when tackling a non-trivial feature, refactor, or design problem and you want the work delegated across model tiers instead of done inline — "design and build X", "plan then implement Y the tiered way", "delegate this properly". You (the Opus coordinator) draft a rough plan WITH the user via brainstorming, hand it to design-panel (Opus and/or Fable architect(s), your choice) to refine into a waved plan, pause for the user's approval, then run each wave through the execute-wave workflow — fresh Opus builders for substantive steps, Sonnet for mechanical, Haiku for menial, each in its own git worktree — and close with a deep review (review-panel). NOT for trivial one-line edits (just do those) or whole-repo review (use full-project-review).
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
  long-standing bugs, or tracing the blast radius of a decision. Once Fable owns a
  panel aspect, integrate that panel with Fable too.
- **Opus** — three uses:
  - **You, the coordinator** — orchestration only: brainstorm with the user,
    route work, keep them in the loop, decide between tiers. Keep your own context
    lean; do NOT implement inline.
  - **`tiered-development:builder` (Opus)** — the primary implementer, launched
    fresh per substantive step so each gets a clean, focused context.
  - **Default thinking tier** for `architect` / `deep-reviewer` and the **floor for
    the plan/verdict integrator** (never below Opus) — Fable's stand-in.
- **Sonnet** (`tiered-development:reader`, `tiered-development:implementer`,
  `tiered-development:verifier`) — the workforce: read-only research, mechanical
  edits, the per-wave verifier, the tier **composer**, and the git integrator on conflict.
- **Haiku** — the floor for genuinely menial work: `implementer` on menial steps,
  the git integrator by default, and cheap `reader` lookups.

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
wave-grouped plan. **Call `EnterPlanMode` as you dispatch design-panel** —
design-panel is read-only so plan mode permits it, and this makes the step-3
approval gate harness-enforced (no edit can slip through before the user says go):

```
Workflow({ name: "tiered-development:design-panel", args: { level, task, roughPlan, panelModels, integratorModel } })
```

- `level` is `quick` | `standard` | `deep` — sets the plan's step budget. Scale it to the task.
- `task` is the task description; `roughPlan` is what you and the user drafted in step 1.
- **`panelModels`** (optional) — a 1–5 array of `"opus"`/`"fable"`, one architect
  each: `["opus"]` a single Opus refine, `["opus","opus","opus"]` an Opus panel,
  `["fable","opus","fable"]` a mixed panel. On a multi-member panel the architects
  **divide the labour by aspect** (correctness, architecture, decomposition,
  verification, risk) — each owns one, with the whole plan for context — rather than
  each redundantly re-refining everything.
- **`integratorModel`** (optional, `"opus"`|`"fable"` — **never Sonnet**) — the model
  that merges the aspect-refined plans into the final one. **Defaults to the top tier
  present in the panel**, so a panel containing Fable integrates with Fable
  automatically (once Fable owns a hard aspect, an equal must merge it). The two-tier
  pattern — an Opus panel then a Fable integrator (`panelModels:["opus","opus","opus"],
  integratorModel:"fable"`) — puts Fable on the *final* design only.
- **Omit both** to let a cheap Sonnet composer pick the composition (Opus-leaning,
  Fable only for high complexity/impact). Set them when you want control.

It returns `{ design, plan, waves }` — `design` is `{ recommendation, rationale,
risks }`; `plan` is an array of steps, each `{ idx, title, files, change,
complexity, wave, verify }` (complexity ∈ `menial`|`mechanical`|`substantive`),
already grouped into ascending file-disjoint waves. If it returns a `BLOCKER`
instead (the rough plan was contradictory or its premise is wrong), resolve it with
the user before proceeding.

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
Workflow({ name: "tiered-development:execute-wave", args: { task, wave, steps, isGit, totalSteps, baseRef, integratorModel } })
```

- `steps` is just this wave's steps (filter the plan by `wave`). Each carries a
  three-tier `complexity` (`menial`→Haiku / `mechanical`→Sonnet / `substantive`→Opus).
  **Leave a step's `complexity` blank to let a Sonnet composer pick its tier**; a
  *garbage* value is refused loudly (fix it), but absence just means "you decide".
- `isGit` is your first probe result; `totalSteps` is the whole plan's step count
  (for nicer labels).
- `integratorModel` (optional, `"haiku"`|`"sonnet"`) — the git-branch integrator.
  Defaults to **Haiku**, escalating to Sonnet automatically on conflict; override only
  to pin it. (This is the *git* integrator — distinct from the ≥Opus plan integrator.)
- `baseRef` is the current `HEAD` sha you just probed. The harness cuts each worker's
  isolation worktree from the repo's **default branch**, not your checked-out branch,
  so the workers reset onto `baseRef` to build on the right foundation. **Re-probe it
  every wave** — the integrator advances your branch as each wave merges in, so
  passing the fresh tip is what carries the prior waves' results into the next one.

Each wave's steps run **in parallel, each in its own git worktree** (substantive →
Opus `tiered-development:builder`, mechanical/menial → Sonnet/Haiku
`tiered-development:implementer`); a git integrator merges the wave's branches back
into your working tree; then a **single** `tiered-development:verifier` checks all
the wave's steps against the integrated tree (one verifier, not one per step, so it
also catches interactions between them). Worktrees are used for **every** step in a
git repo — even a single sequential step — so the workers' in-progress,
transiently-broken edits never reach your tree and never flood your language server
with false diagnostics. Outside git it falls back to sequential edits in the shared tree.

`execute-wave` returns `{ wave, results, integration }`. **React between waves —
this is why you call it per wave rather than handing over the whole plan:**

- If a step returns a `BLOCKER` or a question, apply the **## Escalation rule** below.
- If the wave verifier returns `fail` or `needs-changes` on a step (it ran cleanly
  but the result is wrong — not a `BLOCKER`), do **not** advance the wave. Spin a
  targeted fix-up: re-dispatch that one step as its own single-step wave via
  `tiered-development:execute-wave`, escalating its tier (send it to
  `tiered-development:architect` if the fix needs a design decision), and re-verify
  before moving on.
- If `integration.conflict` is not `none` **or** `integration.failed` is set, stop
  and inspect. A conflict means the wave's steps were not actually file-disjoint —
  re-plan that boundary. `failed` means the integrator returned no result and could
  not confirm the merge (a crashed integrator, distinct from a genuine file-overlap
  conflict) — inspect the tree before continuing.
- If a step you routed to Sonnet turns out to need judgement, re-route it to a
  `tiered-development:builder` rather than accepting a guessed result.

Only move to the next wave once the current one is integrated and clean, so the
next wave sees the settled result.

### 5. Final deep review

Once the whole change is assembled, run the cross-cutting review the per-wave
verifiers cannot (especially interactions between steps built in isolation), then
relay the verdict to the user. Two ways, scale to the change:

- **Deep / high-stakes** — `tiered-development:review-panel`, mirroring design-panel:

  ```
  Workflow({ name: "tiered-development:review-panel", args: { level, task, design, changed, files, reviewModels, integratorModel } })
  ```

  `reviewModels` (1–5 of `"opus"`/`"fable"`) fans out reviewers on distinct lenses;
  `integratorModel` (`"opus"`|`"fable"`, **never Sonnet**) merges them into one
  verdict (most severe wins). The two-tier pattern (`reviewModels:["opus","opus"],
  integratorModel:"fable"`) puts Fable on the *final* verdict only. Omit both to let
  the Sonnet composer pick. Returns `{ review: { verdict, evidence, problems } }`.
- **Light** — a single `tiered-development:deep-reviewer` inline via the `Agent` tool
  (pick `model: opus`, or `fable` if it warrants the cost). No fan-out, no workflow.

**If the verdict is not `pass`, do not proceed to step 6.** Loop back: spin a
targeted fix-up wave for the flagged steps (via `tiered-development:execute-wave`,
escalating tier as needed), or re-plan via `tiered-development:design-panel` if the
design itself is wrong — then re-review. Only a `pass` advances to Integrate.

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
- **Parallelism.** Independent, file-disjoint steps in the same wave run
  concurrently without stepping on each other; the integrator merges the disjoint
  results back between waves.

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
