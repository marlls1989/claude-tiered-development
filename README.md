# tiered-development

Three-tier model delegation for [Claude Code](https://docs.claude.com/en/docs/claude-code).
Each model does what it is best at, and every implementation task goes to a
**fresh agent with a clean, focused context** — which is what produces better
code than one crowded coordinator context doing everything.

```
        ┌─────────────────────────── Fable ───────────────────────────┐
        │  architect       refine the rough plan into a waved plan     │
        │  deep-reviewer   final cross-cutting review of the whole     │
        └──────────────────────────────────────────────────────────────┘
                              ▲                     │
                    plan / verdict           rough plan
                              │                     ▼
        ┌────────────────────────── Opus ──────────────────────────────┐
        │  coordinator     brainstorm, route, gate, keep you in loop    │
        │  builder         a fresh Opus agent per SUBSTANTIVE step      │
        └──────────────────────────────────────────────────────────────┘
                              ▲                     │
                        results               mechanical steps
                              │                     ▼
        ┌───────────────────────── Sonnet ─────────────────────────────┐
        │  implementer     rote/mechanical edits                       │
        │  reader          read-only research → digest                 │
        │  verifier        adversarial per-step check                  │
        └──────────────────────────────────────────────────────────────┘
```

**The through-line:** you brainstorm a rough plan with the user → Fable refines it
into a waved plan → the coordinator routes each wave → fresh Opus/Sonnet workers
each build one well-scoped slice in its own worktree → Fable reviews the whole.

## What's in the box

### Agents (`agents/`)

| Agent | Tier | Role |
|-------|------|------|
| `architect` | Fable | Refines the brainstormed rough plan into a dispatchable, wave-grouped plan. Read-only; the plan is the deliverable. |
| `deep-reviewer` | Fable | Final deep, cross-cutting review after per-step checks. Read-only, adversarial. |
| `builder` | Opus | Primary implementer of substantive, judgement-requiring code. May decide the *how*, never re-opens the design. |
| `implementer` | Sonnet | Mechanical execution of a single precise step. No design judgement. |
| `reader` | Sonnet | Read-only research; returns a cited digest, not raw file dumps. |
| `verifier` | Sonnet | Adversarial per-step verification against the plan's stated intent. |

### Skill (`skills/tiered-development/`)

`tiered-development` — the **gated coordination** skill, and the single entry
point. The Opus coordinator:

1. **brainstorms a rough plan _with you_** (via `superpowers:brainstorming`,
   grounding the discussion with `reader` agents),
2. hands that rough plan to the **`design-panel`** workflow, where Fable refines
   it into a numbered, wave-grouped plan,
3. **pauses for your approval** (the gate this skill exists for),
4. runs each wave through the **`execute-wave`** workflow — fresh
   `builder`/`implementer` agents, each in its own git worktree — reacting between
   waves to any `BLOCKER`, re-route, or integration conflict,
5. closes with a `deep-reviewer` pass and relays the verdict.

Invoke with `/tiered-development` or by describing the intent ("design and build X
the tiered way").

### Workflows (`workflows/`)

The skill calls two small workflows for the phases with real deterministic
fan-out. There is **no** overarching autonomous workflow — the skill, with its
approval gate, is always in charge.

- **`design-panel`** — refines the brainstormed rough plan into a dispatchable,
  wave-grouped plan. `quick`/`standard` use a single Fable `architect`; `deep`
  runs a 3-architect panel plus a synthesis. Called as
  `Workflow({ name: "design-panel", args: { level, task, roughPlan } })`; returns
  `{ design, plan, waves }`.
- **`execute-wave`** — runs one wave: each step in **its own git worktree**
  (substantive → Opus `builder`, mechanical → Sonnet `implementer`), a Sonnet
  **integrator** merges the wave's branches back, then a `verifier` checks each
  step. Worktrees are used for **every** step in a git repo — even a single
  sequential one — so the workers' in-progress edits never flood the coordinator's
  language server with false diagnostics; outside git it falls back to sequential
  edits in the shared tree. Called as
  `Workflow({ name: "execute-wave", args: { task, wave, steps, isGit } })` once
  per wave.

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

- **Models.** Uses the `fable`, `opus`, and `sonnet` model aliases. Fable is
  Anthropic's top tier; if your account cannot address it, the `architect` /
  `deep-reviewer` frontmatter `model:` can be changed to another alias.
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
