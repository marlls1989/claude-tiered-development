# Changelog

All notable changes to the **tiered-development** plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-06

### Changed
- **Compose is now mandatory and groups the work.** The per-wave composer no longer
  just tiers steps whose complexity is blank — it takes the whole wave and decides
  dispatch, bundling cheap, related menial/mechanical steps into a single
  worker/worktree so a one-line edit no longer spawns its own agent. Every
  `substantive` step stays **solo**, and an explicitly-set `complexity` is treated as
  a **floor** (never downgraded). A code-side guardrail enforces the invariants
  regardless of composer output (coverage exactly once, substantive-solo, floor).
- **Each wave squashes into one commit.** The integrator/verifier now collapses a
  wave into a single summary commit once verification returns **green** (replacing
  the per-step linear-history commits). A failed wave keeps its per-step commits and
  worktrees in place for the coordinator to inspect.

## [0.4.4] - 2026-07-06

### Changed
- Merged the per-wave git integrator and verifier into one Sonnet
  integrate-and-verify step: it merges the wave's worktree branches back, resolves
  conflicts in place, and verifies each step against the integrated tree — diffing
  against the kept worktrees to pinpoint faults the merge introduced. Removed the
  separate Haiku→Sonnet integrator escalation ladder and the `integratorModel`
  argument to `execute-wave`.

## [0.4.3] - 2026-07-06

### Changed
- Skip the plan/verdict integrator for single-member design and review panels (a
  lone reviewer/architect's output needs no merge).

## [0.4.2] - 2026-07-06

### Changed
- Prefer composer-chosen panel composition for design and review panels — a cheap
  Sonnet composer picks the Opus/Fable makeup by default; the coordinator overrides
  only when the user asks for a specific one.
- `execute-wave` integrator rebases worktree branches onto the working branch for
  linear history (no merge commits).
- Tightened coordinator discipline: no inline checks/reads; forward
  builder/implementer flags into the final-review context; plan-mode
  dispatch-then-`EnterPlanMode`, re-gating on a re-plan.

### Fixed
- `review-panel` strips the internal lens tag from returned candidates; assorted
  integrator-escalation wording fixes.

## [0.4.1] - 2026-07-05

### Changed
- Restrict the `verifier` to read-only tools via a frontmatter allowlist.
- `architect` and `deep-reviewer` default to Opus.
- Harden `execute-wave`: task guard, step-`idx` uniqueness check, null-integrator
  escalation, consistent implementer report.

### Fixed
- `review-panel` reviewer-lens mislabel; expanded the lens set to five.
- `design-panel` compose-log ordering.
- Docs: namespaced workflow examples, corrected `execute-wave` signature/`baseRef`
  note, fixed the Fable-default claim.

## [0.4.0] - 2026-07-05

### Changed
- Flexible model tiering: fold in Haiku for genuinely menial work, spend Fable
  sparingly (it bills extra), and let the coordinator choose models per slice.

## [0.3.4] - 2026-07-05

### Changed
- `execute-wave` accepts common `complexity` synonyms and rejects unknown values
  loudly rather than guessing a tier.

## [0.3.3] - 2026-07-04

### Fixed
- Reset each wave's worktrees onto the coordinator's `HEAD` (`baseRef`) before
  building — the harness cuts isolation worktrees from the repo's default branch,
  not the checked-out one.

## [0.3.2] - 2026-07-04

### Changed
- Namespace every agent and workflow reference with the `tiered-development:` prefix
  (bare names do not resolve).

## [0.3.1] - 2026-07-04

### Fixed
- Parse `execute-wave` args that arrive as a JSON string; namespace skill
  invocations.

## [0.3.0] - 2026-07-03

### Changed
- Replaced the autonomous workflow with a **gated coordination skill** plus two
  fan-out workflows (`design-panel`, `review-panel`) — the coordinator drafts and
  refines a plan, pauses at a single user-approval gate, then executes and reviews.

## [0.2.0] - 2026-07-02

### Added
- Worktree parallelism for implementation agents.

## [0.1.0] - 2026-07-02

### Added
- Initial release of the tiered-development plugin: the tiered agents, the
  coordination workflow, and install/repository documentation.
