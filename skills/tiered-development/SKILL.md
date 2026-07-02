---
name: tiered-development
description: Use when tackling a non-trivial feature, refactor, or design problem and you want the work delegated across model tiers instead of done inline — "design and build X", "plan then implement Y the tiered way", "delegate this properly". Routes deep design/planning to Fable, keeps the Opus coordinator orchestrating (with a human approval gate) while launching a fresh agent per task — Opus builders for substantive code, Sonnet for mechanical edits and verification — so each task gets a clean, focused context. NOT for trivial one-line edits (just do those) or whole-repo review (use full-project-review).
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

3. **Execute — launch a fresh agent per step, routed by tier.** Split the
   approved plan into self-contained steps and dispatch each to a freshly-spawned
   agent with only the context that step needs. You (the coordinator) do not
   edit code yourself — you route.
   - **Substantive steps → a fresh Opus `builder` per step** — non-trivial logic,
     wiring that needs decisions, anything where the "how" is not fully spelled
     out. Give each its own focused prompt (the design intent, the files, what to
     verify). Launch independent builders in parallel (one message, multiple
     Agent calls).
   - **Mechanical steps → the Sonnet `implementer`** — rote renames, applying a
     settled pattern across files, boilerplate — with a self-contained prompt
     that contains no open judgement. Also parallel where independent. Use
     `reader` (Sonnet) for any read-only lookup a step needs.
   - Watch for cross-step file conflicts: steps that edit the same file must run
     in sequence (or in worktrees), not in parallel.
   - If a step you routed to Sonnet turns out to need judgement, re-route it to a
     `builder` rather than letting the implementer guess.

4. **Per-step check — Sonnet.** After each change, dispatch a `verifier`
   (Sonnet), adversarial by default, against that step's stated intent.

5. **Final deep review — Fable.** Once the change is assembled, dispatch
   `deep-reviewer` (Fable) for the whole-change gate — the cross-cutting review
   the per-step verifiers cannot do. Relay its verdict to the user, then handle
   integration (commit/PR) under the user's existing git-permission prompts.

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
deterministically — launching a fresh worker per step, routed by complexity —
but cannot pause for approval, so the gate in step 2 is lost.
Default to this gated skill unless the user asks for autonomy.

## When NOT to use

- Trivial edits (a rename, a one-liner) — just do them inline; the tiering
  overhead is not worth it.
- Reviewing an entire existing codebase — use `full-project-review`.
- A change where the design is already fully decided — skip the architect and
  go straight to dispatching workers (`builder` / `implementer`).
