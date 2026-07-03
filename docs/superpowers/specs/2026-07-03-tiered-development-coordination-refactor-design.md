# Tiered Development — coordination refactor design

**Date:** 2026-07-03
**Status:** approved (brainstorm), pending implementation plan

## Problem

The plugin currently ships two ways to run the same pipeline:

- `skills/tiered-development/SKILL.md` — a **gated, interactive** coordinator
  playbook with a human approval gate.
- `workflows/tiered-development.js` — an **autonomous, monolithic** workflow that
  runs the whole Fable → Opus/Sonnet → Fable pipeline deterministically with no
  approval gate.

The monolithic autonomous workflow is not what we want. The desired shape is:

1. **No overarching autonomous workflow.** The skill is the single entry point
   and the coordination brain.
2. **Small, purpose-built workflows** only for the phases that genuinely benefit
   from deterministic fan-out — the coordinator calls them; they are its parallel
   engines, not a replacement for it.
3. **Token-lean agent ↔ coordinator communication**, via a shared "caveman-style"
   comms protocol: precise but succinct.
4. **The plan phase is seeded by brainstorming.** The coordinator drafts a rough
   plan *with the user* (via `superpowers:brainstorming`), then sends that rough
   plan to Fable for refinement into a dispatchable, wave-grouped plan — rather
   than Fable designing from a blank slate.

## Goals

- Delete the monolithic autonomous workflow.
- Keep the skill as the one gated entry point; it orchestrates everything.
- Extract exactly two deterministic-fan-out phases into their own small workflows
  the skill calls: **design refinement (a panel)** and **wave execution**.
- Add a shared comms protocol document that all agents and coordinator prompts
  reference, so returns are terse, structured, and token-cheap without losing
  precision.
- Integrate the plan phase with brainstorming: rough plan drafted with the user,
  refined by Fable.
- Use isolated git worktrees for **all** implementation work when in a git repo —
  not only for multi-step parallel waves — because worktree isolation keeps the
  coordinator's tree (and therefore its language-server diagnostics) clean even
  for sequential single-step work.

## Non-goals

- No change to the tier assignments (Fable design/review, Opus coordinate/build,
  Sonnet mechanical/read/verify).
- No autonomous, gate-free end-to-end path. Removed on purpose.
- No new agents. The existing six are reused.
- Not for trivial edits or whole-repo review (unchanged guidance).

## Architecture

The skill is the coordinator (runs on Opus) and the only entry point. It calls
two small workflows for the parallel phases and does everything else inline via
the `Agent` tool.

```
user -> /tiered-development (skill, coordinator on Opus)
  1. Brainstorm WITH the user -> rough plan (approach + rough steps)
       - superpowers:brainstorming drives the dialogue
       - `reader` (Sonnet) agents gather context to ground the discussion
  2. Workflow(design-panel) -> Fable refines the rough plan
       -> a numbered, wave-grouped, dispatchable plan (+ design summary)
  3. GATE: present refined design + plan -> user approves or adjusts
  4. loop over waves: Workflow(execute-wave) once per wave
       - parallel worktree build (Opus builder / Sonnet implementer)
       - integrate the wave's worktree branches back
       - parallel per-step verify (Sonnet verifier)
       - coordinator handles BLOCKER / escalation / re-route BETWEEN waves
  5. deep-reviewer (Fable) dispatched inline via Agent (single agent, no fan-out)
  6. final commit / PR under the user's existing git-permission prompts
```

### Why this split

- **A phase becomes a workflow only if it has deterministic fan-out to gain**:
  the design panel (N architects + a synthesis) and wave execution (parallel
  builders + integrate + parallel verifiers). These are loops/barriers a script
  runs better than the coordinator does by hand.
- **Everything else stays inline in the skill**: the brainstorm dialogue and the
  approval gate need a human and cannot live in a background workflow; routing
  and escalation need coordinator judgement; the deep review is a single agent
  with nothing to fan out.
- **Per-wave, not all-waves, execution** keeps the coordinator in the loop
  between waves so the escalation rule still works: a `BLOCKER` from a worker can
  be escalated to `architect` or the user, and a mis-tagged step re-routed to the
  right tier, before the next wave runs on the integrated result.

## Component: `workflows/design-panel.js`

Refinement of a rough plan, **not** blank-slate design.

- **Input (`args`):** `{ level, task, roughPlan }`
  - `level` ∈ `quick` | `standard` | `deep`
  - `task` — the free-form task description
  - `roughPlan` — the approach + rough steps produced with the user during
    brainstorming
- **Behaviour:**
  - `quick` / `standard`: one `architect` (Fable) refines `roughPlan` into a
    design summary + a numbered, wave-grouped plan.
  - `deep`: three `architect`s refine in parallel, each biased to a distinct
    angle (MVP-first, robustness/edge-cases, fit-with-architecture); a synthesis
    `architect` merges them into one refined plan.
- **Output:** `{ design: { recommendation, rationale, risks }, plan: [ steps ] }`
  where each step has `{ title, files, change, complexity, wave, verify }` — the
  same step shape the old monolith used (`PLAN_SCHEMA`), so `execute-wave` can
  consume it directly.
- Collapses the old separate "Design" and "Plan" phases into a single
  refinement pass seeded by the brainstormed rough plan.

## Component: `workflows/execute-wave.js`

Runs exactly one wave.

- **Input (`args`):** `{ task, wave, steps, isGit }`
  - `steps` — this wave's steps (each with `idx`, `title`, `change`,
    `complexity`, `files`, `verify`)
  - `isGit` — whether the working directory is a git repo (probed once by the
    coordinator and passed in)
- **Behaviour:**
  - If `isGit`: run every step in **its own git worktree** (regardless of step
    count), then an integrator merges the wave's branches back into the working
    tree. Worktrees are used even for a single sequential step — the point is to
    keep the coordinator's tree and its LSP diagnostics clean, not only to
    parallelise.
  - If not `isGit`: fall back to sequential edits in the shared tree (no
    worktrees, no integrate step).
  - Route each step by `complexity`: `substantive` → Opus `builder`,
    `mechanical` → Sonnet `implementer`.
  - Verify each step in parallel with a Sonnet `verifier` against its stated
    intent.
- **Output:** `{ results: [ { step, wave, tier, worktree, implemented, verdict,
  evidence, problems, integrationConflict? } ], integration }`.
- The skill loops over the plan's waves, calling this once per wave, and reacts
  between waves (escalation, re-route, or stop on integration conflict).

### Worktree policy (changed)

Old behaviour: worktrees only when `isGit && waveSteps.length > 1`.
New behaviour: worktrees whenever `isGit`. Single-step waves still run in an
isolated worktree and are merged back. Shared-tree sequential is only the no-git
fallback. Rationale: worktree isolation prevents the workers' in-progress,
transiently-broken edits from flooding the coordinator's language server with
false diagnostics — a benefit that applies to sequential work, not just parallel
work.

## Component: `skills/tiered-development/comms-protocol.md`

The single source of truth for how every agent talks back to the coordinator.
"Caveman-style": precise but succinct.

Rules:

- Return **data, not prose**. When a workflow supplies a schema, fill it; do not
  add narration around it.
- Drop articles, filler, hedging, pleasantries, and praise. Fragments are fine.
- **`path:line` on every code claim.** Return a digest, never a file dump. Do not
  restate the prompt or the task back to the coordinator.
- Quote the **shortest decisive line** of command output; do not dump full logs
  unless explicitly asked.
- **Verbatim, always** — never compress these: error strings, commands,
  identifiers, verdict keywords (`pass` / `needs-changes` / `fail`), and the
  `BLOCKER` / `QUESTION` markers.
- **Auto-clarity carve-out.** Never compress a `BLOCKER` / `QUESTION`
  explanation, the choices in a surfaced ambiguity, or a security warning. These
  stay fully clear. Compression serves the coordinator; it must never create a
  misread. (Mirrors the caveman mode's own auto-clarity rule.)

Referenced by:

- The two workflows' `agent()` prompts, via a shared `COMMS` fragment (sibling to
  the existing `GROUNDING` fragment) that embeds the protocol's essence.
- The skill's inline coordinator prompts (same `COMMS` fragment).
- Each of the six agents: the bespoke "Report concisely / final message" closing
  is replaced with a pointer to this document plus a one-line gist, so an agent
  behaves correctly even if it does not open the file.

## Removals and edits

- **Delete** `workflows/tiered-development.js`.
- **Rewrite** `skills/tiered-development/SKILL.md`: the new
  brainstorm → refine → gate → wave-loop → deep-review flow; drop the
  "Autonomous alternative" section; document the two workflows it calls and the
  comms protocol.
- **Edit** the six agents in `agents/`: replace each bespoke output/closing
  section with the comms-protocol pointer + gist. Keep every agent's role,
  ASK-BACK rule, and tier unchanged.
- **`.claude-plugin/plugin.json`:** fix the description (remove "and an
  autonomous workflow"; describe the gated skill + two helper workflows); bump
  `0.2.0` → `0.3.0`.
- **`.claude-plugin/marketplace.json`:** bump version to match; adjust
  description if needed.
- **`README.md`:** rewrite the workflow section to describe the two small
  workflows and the brainstorm-seeded flow; remove the autonomous-workflow
  framing.

## Data contracts (shared shapes)

- **Step** (produced by `design-panel`, consumed by `execute-wave`):
  `{ title, files: string[], change, complexity: 'mechanical'|'substantive',
  wave: int, verify }`, plus a coordinator-assigned stable `idx`.
- **Verdict** (from `verifier` / `deep-reviewer`):
  `{ verdict: 'pass'|'needs-changes'|'fail', evidence, problems }`.
- **Design** (from `design-panel`): `{ recommendation, rationale, risks }`.

These are the same schemas the monolith used; they are preserved so the pieces
compose.

## Testing / verification

- Manual dry-run of the skill on a small real change in this repo (or a scratch
  repo): confirm brainstorm → refine → gate → one wave → verify → deep-review
  runs end-to-end and the worktrees are created and merged back cleanly.
- Confirm `execute-wave` creates a worktree even for a single-step wave in a git
  repo, and falls back to the shared tree outside git.
- Confirm the plugin still loads (agents register, skill invokes, workflows are
  discoverable) after the monolith is removed and the manifests are bumped.
- Confirm agent returns are visibly terser once they reference the comms
  protocol (spot-check a `reader` and a `verifier` return).

## Open questions

None outstanding. Worktree-always-when-git, per-wave execution, brainstorm-seeded
refinement, and the caveman comms protocol are all decided.
