# tiered-development

Three-tier model delegation for [Claude Code](https://docs.claude.com/en/docs/claude-code).
Each model does what it is best at, and every implementation task goes to a
**fresh agent with a clean, focused context** — which is what produces better
code than one crowded coordinator context doing everything.

```
        ┌─────────────────────────── Fable ───────────────────────────┐
        │  architect       design the approach + the plan              │
        │  deep-reviewer   final cross-cutting review of the whole     │
        └──────────────────────────────────────────────────────────────┘
                              ▲                     │
                     plan / verdict          design + plan
                              │                     ▼
        ┌────────────────────────── Opus ──────────────────────────────┐
        │  coordinator     orchestrates, routes, keeps you in the loop  │
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

**The through-line:** Fable thinks → the coordinator routes → fresh Opus/Sonnet
workers each build one well-scoped slice → Fable reviews the whole.

## What's in the box

### Agents (`agents/`)

| Agent | Tier | Role |
|-------|------|------|
| `architect` | Fable | Design + implementation planning. Read-only; the plan is the deliverable. |
| `deep-reviewer` | Fable | Final deep, cross-cutting review after per-step checks. Read-only, adversarial. |
| `builder` | Opus | Primary implementer of substantive, judgement-requiring code. May decide the *how*, never re-opens the design. |
| `implementer` | Sonnet | Mechanical execution of a single precise step. No design judgement. |
| `reader` | Sonnet | Read-only research; returns a cited digest, not raw file dumps. |
| `verifier` | Sonnet | Adversarial per-step verification against the plan's stated intent. |

### Skill (`skills/tiered-development/`)

`tiered-development` — the **gated, interactive** path. The Opus coordinator
dispatches `architect`, presents the design + plan, **pauses for your approval**,
then launches fresh `builder`/`implementer` agents per step, runs `verifier`
checks, and closes with a `deep-reviewer` pass. Invoke with `/tiered-development`
or by describing the intent ("design and build X the tiered way").

### Workflow (`workflows/tiered-development.js`)

`tiered-development` — the **autonomous** counterpart (no mid-run approval gate;
a background workflow cannot prompt). Fable designs and plans, tags each step
`mechanical` vs `substantive`, then routes substantive → Opus `builder` and
mechanical → Sonnet `implementer`, each followed by a `verifier`, and finishes
with a `deep-reviewer`. Run it with:

```
Workflow({ name: "tiered-development", args: "<level> <task>" })
```

`<level>` is `quick` | `standard` | `deep` (scales the design panel and the plan
step cap). Example: `deep add a --json output mode to the report command`.

## Install

### Option A — as a plugin (recommended)

This repo is its own Claude Code marketplace.

```
/plugin marketplace add <your-git-url>      # e.g. github.com/you/claude-tiered-development
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
- Fill in the `homepage`/`repository` fields in `.claude-plugin/plugin.json` and
  the git URL above once you have pushed.

## License

MIT — see [LICENSE](LICENSE).
