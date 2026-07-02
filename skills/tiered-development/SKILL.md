---
name: tiered-development
description: Use when tackling a non-trivial feature, refactor, or design problem and you want the work delegated across model tiers instead of done inline — "design and build X", "plan then implement Y the tiered way", "delegate this properly". Routes deep design/planning to Fable, keeps the Opus coordinator orchestrating (with a human approval gate) while launching a fresh agent per task — Opus builders for substantive code, Sonnet for mechanical edits and verification — each in its own git worktree so independent steps run in parallel and the coordinator's context stays clean (no LSP-diagnostic flood). NOT for trivial one-line edits (just do those) or whole-repo review (use full-project-review).
---

# Tiered Development

## Overview

Deliberate three-tier delegation so each model does what it is best at:

- **Fable** (`architect`, `deep-reviewer`) — the hardest thinking: design,
  implementation planning, and the final deep review of subtle logic.
- **Opus** — two roles, kept separate on purpose:
  - **You, the coordinator** — orchestration only: dispatch, integrate, keep the
    user in the loop, decide between tiers. Keep your own context lean; do NOT
    implement inline.
  - **`builder` (Opus)** — the primary implementer. Launch a *fresh* builder for
    each substantive, judgement-requiring step so it gets a clean, focused
    context — cleaner context per task is what produces better code, and it keeps
    the coordinator's context uncluttered.
- **Sonnet** (`reader`, `implementer`, `verifier`) — the cheap parallel
  workforce for the rote work: mechanical edits (rename X to Y, apply a settled
  pattern across files, boilerplate), read-only research, and per-step
  verification. Not for anything needing implementation judgement.

**Why launch agents instead of doing it yourself:** every implementation task
goes to a freshly-spawned agent with only the context that task needs. That
focus — not the coordinator juggling the whole job in one crowded context — is
what raises code quality. The coordinator's job is to slice the work cleanly and
route each slice to the right tier.

This builds on `superpowers:subagent-driven-development` — follow that skill's
mechanics (self-contained prompts, fresh-context subagents, BLOCKED handling),
with the tier assignments below made explicit. The point of the tiers is cost
and quality at once: never do design thinking on the cheap tier, never burn the
top tier on mechanical edits.

## The protocol

1. **Design & plan — Fable.** Dispatch the `architect` agent
   (`subagent_type: "architect"`, which runs on Fable) with the full problem,
   the constraints, and the relevant file paths. It returns a design (approaches
   + trade-offs + recommendation) and a numbered, independently-dispatchable
   implementation plan. Use `reader` (Sonnet) first if you need to gather
   context to brief the architect well.

2. **GATE — the user approves.** Present the architect's recommendation, the
   trade-offs, and the plan to the user, then **stop and ask them to approve or
   adjust before any edit is made.** This honors the user's standing "plan before
   changes" rule. Do not dispatch a single worker until the user says go.

3. **Execute — parallel workers in isolated workspaces, routed by tier.** Group
   the approved steps into **waves**: a wave is a set of steps that are
   independent and touch **disjoint files**, so they can run at once; put a step
   that depends on another in a later wave. You (the coordinator) do not edit
   code yourself — you route and integrate.
   For each wave, launch every step's worker **in parallel, each in its own git
   worktree** (`isolation: "worktree"` on the Agent call):
   - **Substantive steps → a fresh Opus `builder`** — non-trivial logic, wiring
     that needs decisions, anything where the "how" is not fully spelled out.
   - **Mechanical steps → the Sonnet `implementer`** — rote renames, applying a
     settled pattern, boilerplate. Use `reader` (Sonnet) for read-only lookups.

   Each worker gets a self-contained prompt (design intent, files, what to
   verify) and, being in its own worktree, edits without touching your tree.

4. **Integrate the wave.** Once a wave's workers finish, merge their worktree
   branches back into the working tree (clean by construction — the files are
   disjoint). Resolve/inspect only if something collided, then move to the next
   wave so it sees the integrated result. If a step you routed to Sonnet turns
   out to need judgement, re-route it to a `builder` rather than letting the
   implementer guess.

5. **Per-step check — Sonnet.** After a wave is integrated, dispatch a `verifier`
   (Sonnet), adversarial by default, per step against its stated intent.

6. **Final deep review — Fable.** Once the whole change is assembled, dispatch
   `deep-reviewer` (Fable) for the cross-cutting review the per-step verifiers
   cannot do (especially interactions between steps built in isolation). Relay
   its verdict to the user, then handle final integration (commit/PR) under the
   user's existing git-permission prompts.

## Workspaces: why worktrees

Implementation workers run in **isolated git worktrees**, not your working tree,
for two reasons:

- **Parallelism.** Independent, file-disjoint steps in the same wave run
  concurrently without stepping on each other; you merge the disjoint results
  back between waves.
- **A clean coordinator context.** Because edits happen in a separate checkout,
  your session's language server never sees the workers' in-progress, often
  transiently-broken edits — so you are **not flooded with LSP diagnostics**
  while work is underway. Verifiers run inside/after each worktree, and you only
  take on the settled, integrated result.

This needs a git repo. See `superpowers:using-git-worktrees` for the mechanics
and the non-git fallback; without git, fall back to sequential edits in the
shared tree (one step at a time).

## Escalation rule

If a Sonnet worker returns BLOCKED, ambiguous, or a question rather than a
result, resolve it yourself or escalate the step back to `architect` (Fable) for
a design decision. Never silently downgrade a judgement call to the cheap tier by
guessing on the worker's behalf — that defeats the whole arrangement.

## Autonomous alternative

If the user explicitly wants it hands-off (no approval gate mid-run), invoke the
`tiered-development` **workflow** instead:
`Workflow({ name: "tiered-development", args: "<level> <task>" })` — level is
`quick`/`standard`/`deep`. It runs the same Fable→(Opus/Sonnet)→Fable pipeline
deterministically — grouping steps into file-disjoint waves, running each wave's
workers in parallel worktrees, and merging them back with an integrator agent —
but cannot pause for approval, so the gate in step 2 is lost.
Default to this gated skill unless the user asks for autonomy.

## When NOT to use

- Trivial edits (a rename, a one-liner) — just do them inline; the tiering
  overhead is not worth it.
- Reviewing an entire existing codebase — use `full-project-review`.
- A change where the design is already fully decided — skip the architect and
  go straight to dispatching workers (`builder` / `implementer`).
