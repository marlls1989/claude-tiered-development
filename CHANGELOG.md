# Changelog

All notable changes to the **tiered-development** plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-07-24

### Added
- **Project guidelines: a committed `GUIDELINES.md` shared with the workforce.** A project's standing rules — global requirements, conventions, practices that hold for *every* task in the repo — now live in `GUIDELINES.md` at the repository root and persist across sessions. The coordinator reads it once at step 0 and forwards it verbatim as the new `guidelines` argument to `design-panel`, `execute-wave` and `review-panel`; each workflow injects it, unsummarised, into every agent that designs, writes or judges code — architects, builders, implementers, batch and final integrators, reviewers (the composers, which only pick models and batch shapes, do not receive it). Guidelines are **hard requirements**: no agent may decide to break one, and a task that cannot be done without violating a guideline is a `BLOCKER` — the agent stops rather than shipping a violating version, names the guideline and the exact conflict, and only the **user** authorises the violation, with a stated justification. The coordinator is explicitly forbidden from resolving that escalation on its own. Omitting the argument (or the file) changes nothing. `skills/tiered-development/project-guidelines.md` documents the format and what does and does not belong in it; this repo's own `GUIDELINES.md` doubles as the worked example.
- **A worker greens its own slice before it commits.** Every job runs a MINIMAL, SCOPED self-check on what it actually changed before committing — it compiles/typechecks, the tests covering the changed part pass, the code is formatted — and quotes the decisive line of each. This is deliberately *not* verification: the integrate-and-verify gate still owns the project's full green bar, the interactions between steps and the adversarial checking, against the integrated tree. A worker is told not to run whole suites or look beyond its slice. A slice that does not stand on its own is a normal consequence of splitting work up, so committing RED is legitimate when it is **declared and explained**. The worker commits anyway (uncommitted work never reaches the integrator) and opens its report with a `RED-COMMIT:` marker giving the criteria it ran, the decisive failing output, **why** it is red, and the **expected resolution** — what makes it green and where that comes from. The qualifying reasons are deliberately open-ended rather than a fixed taxonomy — what is required is the account, not a category match, and a red the worker cannot explain (or for which it cannot say what would ever close it) is broken code that must be fixed or raised as a `BLOCKER`. Two reds are stated as rules rather than left to judgement, because they are never the worker's to fix: a check already failing on the base ref it was given, and a check that cannot run inside an isolated worktree at all — both are declared, not repaired. The wave verifier judges the declaration against reality on the integrated tree — a resolution due within the wave must have arrived, and one deferred beyond it means the wave cannot close green, which is reported as a wave-boundary problem rather than a broken step. `RED-COMMIT` joins `BLOCKER`/`QUESTION` as a keep-verbatim marker in the comms protocol.
- **A single-job batch is never integrated.** A batch of one job has nothing to reconcile — that job's commit already *is* the batch's result — so its sha is handed straight to the next batch as their base and no integrator agent is spawned. Workers end their report with a `COMMIT-SHA: <sha>` line to make this possible; if one is missing or unusable the wave falls back to spawning an integrator rather than guessing a base. Only a batch that actually **fanned out** to two or more jobs costs an integrator.

### Changed
- **Wave-closing verify/format steps are relayed to the integrate-and-verify gate, not built by a worker.** The architect's `role: "verify"` label (a wave's closing format/lint/verify of its own work) now flows through design-panel to `execute-wave` instead of being stripped after wave-folding. There it is an **advisory hint**: the Sonnet composer declares a `relay` list of such step idxs and hands them to the final Sonnet gate, which **performs** them against the *integrated* tree and verdicts each — rather than dispatching them to a worker whose isolated worktree cannot format that tree. The composer keeps the final word and builds a step normally if it produces product code; relaying a step the architect did not tag is legal but logged, since it means no worker builds it. `buildBatches` treats a relayed idx as covered and refuses a declaration that both builds and relays an idx, or that relays every step.
- The gate performs a relayed step **last** — after every built step is verified and diffed against its worker branch, and after the project green bar, immediately before the squash — so a formatter cannot bury the merge-fault diffs in formatting noise. It **skips** the step entirely when the wave is already not green *for any reason, the green bar included*, re-runs the bar after rewriting (a formatter can break it), and if the wave ends not green after files were already rewritten it restores them, so rewritten-but-uncommitted files are never stranded for the next wave's integrator to hit as a dirty-tree blocker. Formatter output is staged narrowly (`git add -u` plus explicitly named new paths) rather than `git add -A`, which would sweep unrelated untracked files into the wave's squash.
- A gate step is **never** re-dispatched as its own single-step wave, whatever its verdict — it has no worker to go to, and doing so would either hand a formatter to an isolated worktree or be refused as a wave with nothing to build. A real gate failure means fixing the cause and re-running the wave.
- **Batches are carried forward off the working branch.** A fan-out batch's integrator `git reset --hard`s onto that batch's base inside **its own isolated worktree**, merges the batch's branches into its own branch, and reports that tip for the next batch. The working branch is therefore untouched until the final integrate-and-verify pass lands the whole wave in one squashed commit. Consequences: the squash base is always the HEAD that final pass records itself (the `start`-sha threading between batch integrators is gone, along with the "no usable squash base exists" path); a wave that aborts mid-batch leaves the working branch exactly where it started (`integration.merged` is 0), so there is nothing to unwind and it can simply be re-run; and the final gate now **verifies** rather than assumes that the final batch descends from every earlier one (`git merge-base --is-ancestor` per earlier branch), since a mis-based worker would otherwise ff-merge cleanly while silently dropping earlier batches.
- **A multi-batch wave now requires a valid `baseRef`** and is refused without one. Carrying batches forward needs a sha to reset each integration worktree onto; the alternative — integrating batches straight onto the working branch — would move that branch mid-wave and put the squash base after earlier batches' commits, breaking the single-commit-per-wave invariant. Single-batch waves are unaffected.
- `agents/verifier.md` reconciled with all of the above: relayed verify/format work is carved out of its "edits confined to reconciling the MERGE" rule, the batch-integrator role is described as worktree-local, the deleted prompt-supplied `START` sha is gone, and it gains the `RED-COMMIT` assessment rule.

## [0.7.0] - 2026-07-08

### Changed
- **execute-wave composer now biases toward few workers.** Sequential dependents that do not build on a prior parallel fan-out are merged into one worker (mixing tiers; a job's tier is the max of its tasks' floors), rather than defaulting to more, smaller jobs. A later batch is started only to build on a prior batch's integrated parallel fan-out of two-plus jobs.
- **Difficulty-driven panel integrator.** The design/review panel integrator selection now defaults to Opus and escalates to Fable only when a panellist reports high `integrationDifficulty`, replacing the old default of Fable-if-a-top-tier-panellist-is-present. The composer now sizes the panel only — it no longer suggests the integrator.
- **review-panel return contract.** `problems` changed from a string to an array of `{ point, confidence? }`; the verbatim QUESTION/BLOCKER ask-back text moved out of `problems` into a new `blocker` field.

### Added
- **Sonnet as an admissible design/review panel model** — explicitly selectable and auto-assignable by the composer to lighter lenses/aspects. The integrator may be pinned to Sonnet explicitly but is never auto-defaulted below Opus.
- **Stuck-integrator escalation ladder** (sonnet → opus → fable): a reasoned stuck integrator verdict (never a crash) re-runs the merge on a more capable model, feeding the prior stuck reason forward.
- **Per-item confidence rating** (`low` | `medium` | `high`) on each design plan step and each review point.

## [0.6.3] - 2026-07-08

### Fixed
- **Schema-legal ask-back for the final wave verifier.** The verifier's per-step verdict enum gains `blocked`: when it genuinely cannot determine a step's outcome it returns `blocked` with its QUESTION/BLOCKER verbatim in that step's `problems`, instead of answering in prose — which the mandatory StructuredOutput call rejected, exhausting the retry cap and crashing the whole wave. A `blocked` step means the wave is not green: no squash, worktrees kept, and the coordinator escalates to the user rather than auto-fixing.
- **Crash-resilient schema calls.** The composer, per-batch integrator, and final verifier agent calls are wrapped in a shared `safeAgent` helper so a StructuredOutput retry-cap crash (or a null return) degrades to a coherent wave-level failure in the returned `{ wave, results, integration }` — `failed: true` with the crash reason quoted — instead of an uncaught error killing the Workflow.
- **Schema-legal ask-back and crash-resilience for review-panel.** The REVIEW_SCHEMA verdict enum gains `blocked`: when a reviewer or integrator encounters a genuine conflict or ambiguity, it returns `blocked` with the QUESTION/BLOCKER verbatim in `problems` instead of answering in prose — which would cause the mandatory StructuredOutput call to reject and crash. The panel's sequential composer and integrator calls are wrapped in `safeAgent`, and the parallel reviewer fan-out uses per-thunk try/catch isolation; a retry-cap crash degrades to the existing no-verdict `{ error }` return (dropped reviewer; fails only if all crash) instead of killing the workflow.
- **Schema-legal ask-back and crash-resilience for design-panel.** The panel's composer and plan integrator are wrapped in `safeAgent`, and the parallel refiner fan-out isolates a crashed architect to a dropped candidate — so a retry-cap crash degrades to the existing `{ error }` return. Additionally, PLAN_SCHEMA now carries an optional `blocker` field: when the architect returns a blocker (empty `steps` and contradictory or wrong-premise reason), it travels inside StructuredOutput and surfaces as `{ error }` instead of a prose BLOCKER reply that would crash.

## [0.6.2] - 2026-07-08

### Changed
- **Composer-declared batches of parallel jobs.** The execute-wave composer now declares an ORDERED list of batches; the jobs inside a batch run in parallel and each job is one worker running one or more tasks sequentially in its own worktree. A dumb scheduler executes exactly that declaration — no dependency evaluation, no derived DAG, and file overlap no longer serialises parallel jobs: the batch integrator resolves any same-file conflict against the tasks stated intent. A step dependsOn is now advisory input the composer may override (the in-wave dependency-cycle refusal is removed), and a structurally invalid composer declaration (a task missing or duplicated) refuses the wave with a clear error.
- **Task-relevant aspect coverage.** The design-panel composer now also picks, for any multi-member panel (including a coordinator-fixed one), which aspects matter most for THIS task and in what order; assignment falls back to the fixed vocabulary order and never duplicates an aspect.
- **Code-enforced wave invariants.** design-panel tags steps with an internal role (deliverable/verify), folds a verify/format-only wave into its neighbouring deliverable wave (refusing a plan with no deliverable work at all), and appends a QUESTION to the design risks when the plan comes back without a greenBar.

## [0.6.1] - 2026-07-08

### Changed
- **Trust-first panel integrators.** Both the design-panel plan integrator and the review-panel verdict integrator now adopt the panel's deliberation instead of re-doing it. The design integrator gets its own scoped grounding — the panel already explored the repo, so it reads code only to settle a genuine conflict — in place of the from-scratch grounding brief, and mediates only where members genuinely conflict. The review integrator adjudicates only disputed claims rather than re-verifying the whole change. Output schemas, control flow, and workflow return shapes are unchanged.

## [0.6.0] - 2026-07-07

### Changed
- **Waves are now complete, green, deliverable slices** rather than file-disjoint
  parallel batches. Plan steps carry explicit `dependsOn` dependencies
  (architect-declared ids, normalised to idx edges), and design-panel returns a
  project `greenBar` (emitting a QUESTION when the project's green criteria are
  unclear).
- **The execute-wave composer owns dispatch.** Coupled steps may be merged into one
  worker or chained across stages, with each non-final stage integrated onto the
  working branch and the next stage's workers reset onto its tip. The
  substantive-always-solo invariant is relaxed to composer discretion (an explicit
  complexity remains a floor).
- **The wave squash is gated on the project's green bar**, and verify/format work
  is only ever a wave's closing step, never a standalone wave.

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
