# tiered-development

Multi-tier model delegation for [Claude Code](https://docs.claude.com/en/docs/claude-code).
Each model does what it is best at, and every implementation task goes to a
**fresh agent with a clean, focused context** — which is what produces better
code than one crowded coordinator context doing everything. You (or a cheap Sonnet
composer) pick the tier for each slice, weighing the judgement it needs against the
cost of getting it wrong.

```
        ┌─────────── Fable — premium tier, spent sparingly ────────────┐
        │  architect / deep-reviewer / integrator   opt-in for high    │
        │  complexity or impact — deep bug-hunts, blast-radius analysis│
        └──────────────────────────────────────────────────────────────┘
                              ▲  opt-in top / integrator
        ┌──────────────────────────── Opus ────────────────────────────┐
        │  coordinator     brainstorm, route, gate, keep you in loop   │
        │  builder         a fresh Opus agent per SUBSTANTIVE step     │
        │  architect / deep-reviewer / integrator   (default here)     │
        └──────────────────────────────────────────────────────────────┘
                              ▲  results            mechanical ▼
        ┌─────────────────────────── Sonnet ───────────────────────────┐
        │  implementer     mechanical edits                            │
        │  reader          read-only research → digest                 │
        │  verifier        merge/resolve, verify, squash on green      │
        │  composer        groups + tiers steps                        │
        │  architect / deep-reviewer   admissible on a lighter         │
        │                  panel lens/aspect; integrator by opt-in     │
        └──────────────────────────────────────────────────────────────┘
                              ▲  results            menial ▼
        ┌─────────────────────────── Haiku ────────────────────────────┐
        │  implementer     menial edits                                │
        │  reader          cheap lookups                               │
        └──────────────────────────────────────────────────────────────┘
```

**The through-line:** you brainstorm a rough plan with the user → an architect
(Opus by default, Sonnet admissible on a lighter aspect, Fable for high
complexity/impact — single, or a panel that divides the plan by aspect) refines it
into a waved plan → the coordinator routes each wave → fresh Opus/Sonnet/Haiku
workers each build one well-scoped slice in its own worktree → a review closes the
loop over the whole change.

## What's in the box

### Agents (`agents/`)

| Agent | Tier | Role |
|-------|------|------|
| `architect` | Sonnet / Opus / Fable | Refines the brainstormed rough plan into a dispatchable, wave-grouped plan. Read-only; the plan is the deliverable. Opus by default; Sonnet admissible on a lighter aspect; Fable for high complexity/impact. A multi-member panel divides the plan by aspect. |
| `deep-reviewer` | Sonnet / Opus / Fable | Final deep, cross-cutting review after the per-wave check. Read-only, adversarial. Opus by default; Sonnet admissible on a lighter lens; Fable when it warrants the cost. |
| `builder` | Opus | Primary implementer of substantive, judgement-requiring code. May decide the *how*, never re-opens the design. |
| `implementer` | Sonnet / Haiku | Mechanical (Sonnet) or menial (Haiku) execution of a single precise step. No design judgement. |
| `reader` | Sonnet / Haiku | Read-only research; returns a cited digest, not raw file dumps. Haiku for cheap lookups. |
| `verifier` | Sonnet | Merges the wave's worker branches back (resolving conflicts in place), one adversarial check per wave against the integrated tree and the plan's stated intent (diffing against the kept worktrees to pinpoint merge-caused faults). On staged waves it merges only the final stage's pending branches (earlier stages were integrated per-stage). Gates the green squash on the project's green bar before collapsing the wave into one summary commit. |

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
  wave-grouped plan. `panelModels` (1–5 of `opus`/`fable`/`sonnet`) sets the
  architect composition — single, panel, mixed, or the two-tier *Opus-panel-then-
  Fable-integrator* pattern; on a multi-member panel the architects **divide the
  plan by aspect** (each owns correctness / architecture / decomposition /
  verification / risk), and Sonnet is admissible for a lighter aspect. The plan
  `integratorModel` **defaults to Opus**, **escalates to Fable only when a
  panellist reports high `integrationDifficulty`**, and is fully overridable —
  including to an explicit Sonnet — via `integratorModel`; it is never
  auto-defaulted below Opus. A stuck integrator climbs a `sonnet → opus → fable`
  escalation ladder. Called as
  `Workflow({ name: "tiered-development:design-panel", args: { level, task, roughPlan, panelModels, integratorModel } })`;
  returns `{ design, plan, waves, greenBar }` — steps carry explicit `dependsOn`
  and an optional per-step `confidence` (low/medium/high), and waves are
  complete, green, deliverable slices.
- **`execute-wave`** — runs one wave: a **mandatory** Sonnet composer **owns
  dispatch**, grouping the wave's steps into worker assignments and tiering each
  (substantive → Opus `builder`, mechanical → Sonnet, menial → Haiku `implementer`);
  independent workers run in parallel, while coupled steps are merged into one
  worker or chained across stages, each stage integrated onto the working branch
  before the next starts so chained workers build on their prerequisites'
  committed result — an explicit `complexity` remains a floor. Each assignment
  runs in **its own git worktree**; then a **single** Sonnet `verifier` merges the
  wave's branches back — resolving any conflict in place — checks all the wave's
  steps against the integrated tree, and on a **green** wave squashes it into one
  summary commit. Worktrees are used for **every** assignment in a git repo — even
  a single sequential one — so the workers' in-progress edits never flood the
  coordinator's language server with false diagnostics; outside git it falls back
  to sequential edits in the shared tree.
  The harness cuts each worker's isolation worktree from the repo's **default**
  branch, not the checked-out one — so `baseRef` (the current HEAD, re-probed each
  wave) is what carries the checked-out branch and prior waves' results to the
  workers. Called as
  `Workflow({ name: "tiered-development:execute-wave", args: { task, wave, steps, isGit, totalSteps, baseRef, greenBar } })`
  once per wave.
- **`review-panel`** — the deep final review: a fan-out of reviewers (each on a
  distinct lens, Sonnet admissible on a lighter lens) closed by an integrator
  that merges them into ONE verdict (most severe wins). `reviewModels` +
  `integratorModel` mirror `design-panel`'s doctrine (Opus-default integrator,
  escalating to Fable on high integration difficulty, overridable incl.
  Sonnet, with the same `sonnet → opus → fable` stuck-integrator ladder).
  Called as `Workflow({ name: "tiered-development:review-panel", args: { level, task, design, changed, files, reviewModels, integratorModel } })`;
  returns `{ review: { verdict, evidence, problems, blocker } }` — `problems`
  is an array of `{ point, confidence? }` entries, and `blocker` carries the
  verbatim QUESTION/BLOCKER text for a `blocked` verdict.

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
