# tiered-development

Multi-tier model delegation for [Claude Code](https://docs.claude.com/en/docs/claude-code).
Each model does what it is best at, and every implementation task goes to a
**fresh agent with a clean, focused context** — which is what produces better
code than one crowded coordinator context doing everything. You (or a cheap Sonnet
composer) pick the tier for each slice, weighing the judgement it needs against the
cost of getting it wrong.

```
        ┌──────────── Fable — premium tier, spent sparingly ───────────┐
        │  architect / deep-reviewer / integrator   opt-in for high      │
        │  complexity or impact — deep bug-hunts, blast-radius analysis  │
        └──────────────────────────────────────────────────────────────┘
                              ▲  opt-in top / integrator
        ┌────────────────────────── Opus ──────────────────────────────┐
        │  coordinator     brainstorm, route, gate, keep you in loop    │
        │  builder         a fresh Opus agent per SUBSTANTIVE step      │
        │  architect / deep-reviewer / plan-integrator (≥Opus floor)    │
        └──────────────────────────────────────────────────────────────┘
                              ▲  results            mechanical ▼
        ┌───────────────────────── Sonnet ─────────────────────────────┐
        │  implementer     mechanical edits                            │
        │  reader          read-only research → digest                 │
        │  verifier        one adversarial check per wave              │
        │  composer        picks tiers when you don't; git merge retry │
        └──────────────────────────────────────────────────────────────┘
                              ▲  git merge          menial ▼
        ┌───────────────────────── Haiku ──────────────────────────────┐
        │  implementer     menial edits                                │
        │  git integrator  merge worktree branches (→ Sonnet on conflict)│
        └──────────────────────────────────────────────────────────────┘
```

**The through-line:** you brainstorm a rough plan with the user → an architect
(Opus by default, Fable for high complexity/impact — single, or a panel that divides
the plan by aspect) refines it into a waved plan → the coordinator routes each wave →
fresh Opus/Sonnet/Haiku workers each build one well-scoped slice in its own worktree
→ a review closes the loop over the whole change.

## What's in the box

### Agents (`agents/`)

| Agent | Tier | Role |
|-------|------|------|
| `architect` | Opus / Fable | Refines the brainstormed rough plan into a dispatchable, wave-grouped plan. Read-only; the plan is the deliverable. Opus by default; Fable for high complexity/impact. A multi-member panel divides the plan by aspect. |
| `deep-reviewer` | Opus / Fable | Final deep, cross-cutting review after the per-wave check. Read-only, adversarial. Opus by default; Fable when it warrants the cost. |
| `builder` | Opus | Primary implementer of substantive, judgement-requiring code. May decide the *how*, never re-opens the design. |
| `implementer` | Sonnet / Haiku | Mechanical (Sonnet) or menial (Haiku) execution of a single precise step. No design judgement. |
| `reader` | Sonnet / Haiku | Read-only research; returns a cited digest, not raw file dumps. |
| `verifier` | Sonnet | One adversarial check per wave, against the integrated tree and the plan's stated intent. |

### Skill (`skills/tiered-development/`)

`tiered-development` — the **gated coordination** skill, and the single entry
point. The Opus coordinator:

1. **brainstorms a rough plan _with you_** (via `superpowers:brainstorming`,
   grounding the discussion with `reader` agents),
2. hands that rough plan to the **`design-panel`** workflow, where an architect (or
   a panel — Opus and/or Fable, your choice, or a Sonnet composer's) refines it into
   a numbered, wave-grouped plan,
3. **pauses for your approval** (the gate this skill exists for),
4. runs each wave through the **`execute-wave`** workflow — fresh
   `builder`/`implementer` agents, each in its own git worktree — reacting between
   waves to any `BLOCKER`, re-route, or integration conflict,
5. closes with a **`review-panel`** pass (or a single inline `deep-reviewer`) and
   relays the verdict.

Invoke with `/tiered-development` or by describing the intent ("design and build X
the tiered way").

### Workflows (`workflows/`)

The skill calls three small workflows for the phases with real deterministic
fan-out. There is **no** overarching autonomous workflow — the skill, with its
approval gate, is always in charge. In each, the model composition is the
coordinator's choice (via `panelModels`/`reviewModels` + `integratorModel`, or a
per-step `complexity`); omit it and a cheap **Sonnet composer** picks, spending
Fable sparingly.

- **`design-panel`** — refines the brainstormed rough plan into a dispatchable,
  wave-grouped plan. `panelModels` (1–5 of `opus`/`fable`) sets the architect
  composition — single, panel, mixed, or the two-tier *Opus-panel-then-Fable-
  integrator* pattern; on a multi-member panel the architects **divide the plan by
  aspect** (each owns correctness / architecture / decomposition / verification /
  risk). The plan `integratorModel` is **≥Opus, never Sonnet**, and **defaults to the
  panel's top tier** (Fable if any panelist is Fable). Called as
  `Workflow({ name: "tiered-development:design-panel", args: { level, task, roughPlan, panelModels, integratorModel } })`;
  returns `{ design, plan, waves }`.
- **`execute-wave`** — runs one wave: each step in **its own git worktree**, routed
  by its three-tier `complexity` (substantive → Opus `builder`, mechanical → Sonnet,
  menial → Haiku `implementer`); a **git integrator** merges the wave's branches back
  (Haiku by default, escalating to Sonnet on conflict); then a **single** `verifier`
  checks all the wave's steps against the integrated tree. Worktrees are used for
  **every** step in a git repo — even a single sequential one — so the workers'
  in-progress edits never flood the coordinator's language server with false
  diagnostics; outside git it falls back to sequential edits in the shared tree.
  The harness cuts each worker's isolation worktree from the repo's **default**
  branch, not the checked-out one — so `baseRef` (the current HEAD, re-probed each
  wave) is what carries the checked-out branch and prior waves' results to the
  workers. Called as
  `Workflow({ name: "tiered-development:execute-wave", args: { task, wave, steps, isGit, totalSteps, baseRef, integratorModel } })`
  once per wave.
- **`review-panel`** — the deep final review: a fan-out of reviewers (each on a
  distinct lens) closed by a ≥Opus integrator that merges them into ONE verdict
  (most severe wins). `reviewModels` + `integratorModel` mirror `design-panel`.
  Called as `Workflow({ name: "tiered-development:review-panel", args: { level, task, design, changed, files, reviewModels, integratorModel } })`;
  returns `{ review: { verdict, evidence, problems } }`.

### Comms protocol (`skills/tiered-development/comms-protocol.md`)

A shared, token-lean convention every agent and every workflow prompt follows:
structured data not prose, `path:line`-cited, verbatim on error strings / commands
/ verdict keywords / `BLOCKER` / `QUESTION`, with an auto-clarity carve-out so a
`BLOCKER` explanation or a security caveat is never compressed into ambiguity.

## Install

### Option A — as a plugin (recommended)

This repo is its own Claude Code marketplace.

```
/plugin marketplace add marlls1989/claude-tiered-development
/plugin install tiered-development@msartori-tools
```

Then reload (`/reload-plugins`) or restart the session so the agents register.

### Option B — copy into your user config

Copy the three directories into `~/.claude/`:

```sh
cp -r agents/*   ~/.claude/agents/
cp -r skills/*   ~/.claude/skills/
cp -r workflows/* ~/.claude/workflows/
```

## Requirements & notes

- **Models.** Uses the `fable`, `opus`, `sonnet`, and `haiku` model aliases. Fable
  is Anthropic's top tier and now bills extra per use, so it is **opt-in** — the
  `architect` / `deep-reviewer` default to `opus` in frontmatter but design-panel /
  review-panel run on whatever `panelModels`/`reviewModels` + `integratorModel` you
  pass (Opus-only compositions never touch Fable). The flow runs end-to-end on
  Opus + Sonnet + Haiku alone.
- **Your session model is the coordinator.** This set assumes you run Claude Code
  on Opus (`"model": "opus"` in `settings.json`). The coordinator orchestrates;
  it does not edit inline.
- **Duplicate agents.** If you already have your own `implementer` / `reader` /
  `verifier` in `~/.claude/agents/`, installing this plugin (which ships its own)
  will collide. Keep one copy — delete the user-level ones, or drop those three
  files from the plugin before installing.
- **Not for trivial edits or whole-repo review.** For a one-liner, just do it.
  For auditing an existing codebase, use `full-project-review` / `/code-review`.
## License

MIT — see [LICENSE](LICENSE).
