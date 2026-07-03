---
name: tiered-development
description: Use when tackling a non-trivial feature, refactor, or design problem and you want the work delegated across model tiers instead of done inline — "design and build X", "plan then implement Y the tiered way", "delegate this properly". You (the Opus coordinator) draft a rough plan WITH the user via brainstorming, hand it to Fable to refine into a waved plan, pause for the user's approval, then run each wave through the execute-wave workflow — fresh Opus builders for substantive steps, Sonnet implementers for mechanical ones, each in its own git worktree — and close with a Fable deep review. NOT for trivial one-line edits (just do those) or whole-repo review (use full-project-review).
---

# Tiered Development

## Overview

Deliberate delegation so each model tier does what it is best at, with you (the
Opus coordinator) orchestrating and the user in the loop at the one gate that
matters.

- **Fable** (`tiered-development:architect`, `tiered-development:deep-reviewer`) —
  the hardest thinking: refining the plan and the final deep review of subtle logic.
- **Opus** — two roles, kept separate on purpose:
  - **You, the coordinator** — orchestration only: brainstorm with the user,
    route work, keep them in the loop, decide between tiers. Keep your own context
    lean; do NOT implement inline.
  - **`tiered-development:builder` (Opus)** — the primary implementer, launched
    fresh per substantive step so each gets a clean, focused context.
- **Sonnet** (`tiered-development:reader`, `tiered-development:implementer`,
  `tiered-development:verifier`) — the cheap workforce: read-only research,
  mechanical edits, and per-step verification.

**Why delegate instead of doing it yourself:** every implementation task goes to a
freshly-spawned agent with only the context that task needs. That focus — not the
coordinator juggling the whole job in one crowded context — is what raises code
quality. Your job is to slice the work cleanly and route each slice to the right
tier.

You drive this. Two phases with real fan-out are extracted into small workflows
you **call** — `design-panel` (refine the plan) and `execute-wave` (build one
wave) — because a script runs their parallelism better than you can by hand.
Everything else — the brainstorm, the approval gate, routing, escalation, the
deep review — stays here, with you.

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
plus a rough list of steps. It does not need to be dispatchable yet — Fable
refines it next. Getting the user's intent right here is what the whole pipeline
depends on.

### 2. Refine the rough plan — Fable, via `design-panel`

Hand the rough plan to Fable to turn into a concrete, dispatchable, wave-grouped
plan:

```
Workflow({ name: "tiered-development:design-panel", args: { level, task, roughPlan } })
```

- `level` is `quick` | `standard` | `deep` — `deep` runs a 3-architect panel plus
  a synthesis; `quick`/`standard` use a single architect. Scale it to the task.
- `task` is the task description; `roughPlan` is what you and the user drafted in
  step 1.

It returns `{ design, plan, waves }` — `design` is `{ recommendation, rationale,
risks }`; `plan` is an array of steps, each `{ idx, title, files, change,
complexity, wave, verify }`, already grouped into ascending file-disjoint waves.
If it returns a `BLOCKER` instead (the rough plan was contradictory or its premise
is wrong), resolve it with the user before proceeding.

### 3. GATE — the user approves

Present the design (recommendation, rationale, risks) and the numbered, waved plan
to the user, then **stop and ask them to approve or adjust before any edit is
made.** This honours the user's standing "plan before changes" rule. Do not run a
single wave until the user says go. This gate is the reason this skill exists
rather than an autonomous workflow — never skip it.

### 4. Execute — one wave at a time, via `execute-wave`

Probe once whether you are in a git repo (`git rev-parse --is-inside-work-tree`,
directly or via a one-line `tiered-development:reader`). Then, for each wave in
ascending order, run:

```
Workflow({ name: "tiered-development:execute-wave", args: { task, wave, steps, isGit, totalSteps } })
```

- `steps` is just this wave's steps (filter the plan by `wave`).
- `isGit` is your probe result; `totalSteps` is the whole plan's step count (for
  nicer labels).

Each wave's steps run **in parallel, each in its own git worktree** (substantive →
Opus `tiered-development:builder`, mechanical → Sonnet
`tiered-development:implementer`); an integrator merges the wave's branches back
into your working tree; then a `tiered-development:verifier` checks each step.
Worktrees are used for **every** step in a git repo — even a single sequential
step — so the workers' in-progress, transiently-broken edits never reach your tree
and never flood your language server with false diagnostics. Outside git it falls
back to sequential edits in the shared tree.

`execute-wave` returns `{ wave, results, integration }`. **React between waves —
this is why you call it per wave rather than handing over the whole plan:**

- If a step returns a `BLOCKER` or a question, resolve it yourself or escalate the
  step back to `tiered-development:architect` (Fable) for a design decision. Never
  silently downgrade a judgement call by guessing on a worker's behalf.
- If `integration.conflict` is not `none`, the wave's steps were not actually
  file-disjoint. Stop, inspect, and re-plan that boundary before continuing.
- If a step you routed to Sonnet turns out to need judgement, re-route it to a
  `tiered-development:builder` rather than accepting a guessed result.

Only move to the next wave once the current one is integrated and clean, so the
next wave sees the settled result.

### 5. Final deep review — Fable, inline

Once the whole change is assembled, dispatch `tiered-development:deep-reviewer`
(Fable) directly with the `Agent` tool — a single agent, no fan-out, so no workflow. Give it the task,
the approved design, and what changed. It does the cross-cutting review the
per-step verifiers cannot (especially interactions between steps built in
isolation). Relay its verdict to the user.

### 6. Integrate

Handle final integration (commit / PR) under the user's existing git-permission
prompts.

## Communication — keep it token-lean

Every agent you dispatch, and every `agent()` call inside the two workflows,
follows `skills/tiered-development/comms-protocol.md`: returns are structured data,
not prose — terse, `path:line`-cited, verbatim on error strings / commands /
verdict keywords / `BLOCKER` / `QUESTION`, and never compressed where a
`BLOCKER`/`QUESTION` explanation or a security caveat needs to be unambiguous. When
you write a prompt for an agent, brief it the same way: say what you need back, not
a restatement of the task.

## Escalation rule

If a Sonnet worker returns `BLOCKER`, ambiguous, or a question rather than a
result, resolve it yourself or escalate the step back to
`tiered-development:architect` (Fable) for a design decision. Never silently downgrade a judgement call to the cheap tier by
guessing on the worker's behalf — that defeats the whole arrangement.

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

This needs a git repo. See `superpowers:using-git-worktrees` for the mechanics;
without git, `execute-wave` falls back to sequential edits in the shared tree.

## When NOT to use

- Trivial edits (a rename, a one-liner) — just do them inline; the tiering
  overhead is not worth it.
- Reviewing an entire existing codebase — use `full-project-review`.
- A change where the approach is already fully decided and needs no plan — skip
  the brainstorm/refine and go straight to dispatching workers
  (`tiered-development:builder` / `tiered-development:implementer`), still via
  `execute-wave` if you want the worktree isolation.
