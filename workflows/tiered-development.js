export const meta = {
  name: "tiered-development",
  description: "Three-tier delegation pipeline: Fable designs the approach and the plan, Opus implements the substantive steps while Sonnet handles the mechanical ones and verifies each, Fable does the final deep review. Independent steps in the same wave run in parallel, each in its own git worktree, then an integrator merges them back. The autonomous (no approval gate) counterpart to the tiered-development skill.",
  whenToUse: "When the user explicitly wants a non-trivial change designed and built hands-off across model tiers. Pass args as \"<level> <task>\" — level is quick, standard, or deep (default standard); task is the free-form description of what to build (e.g. \"deep add a --json output mode to the report command\"). It CANNOT pause for approval — use the tiered-development skill when the user wants to approve the plan first.",
  phases: [
    { title: "Design", detail: "Fable architect(s) weigh approaches and recommend one; deep level runs a panel + synthesis", model: "fable" },
    { title: "Plan", detail: "Fable architect turns the recommendation into a numbered plan, grouped into file-disjoint waves", model: "fable" },
    { title: "Implement", detail: "Per wave: Opus builders (substantive) + Sonnet implementers (mechanical) run in parallel, each in its own worktree", model: "opus" },
    { title: "Integrate", detail: "Sonnet integrator merges each wave's worktree branches back into the working tree", model: "sonnet" },
    { title: "Verify", detail: "Sonnet verifier checks each step against its stated intent", model: "sonnet" },
    { title: "Final Review", detail: "Fable deep-reviewer does the cross-cutting whole-change review", model: "fable" },
  ],
}

// ─── Effort levels — scale the design panel and the plan-step cap ───
const LEVEL_PARAMS = {
  quick:    { panel: 1, maxSteps: 6 },
  standard: { panel: 1, maxSteps: 10 },
  deep:     { panel: 3, maxSteps: 16 },
}

const RAW_ARGS = (typeof args === "string" ? args : "").trim()
const FIRST = RAW_ARGS.split(/\s+/)[0] || ""
const FIRST_IS_LEVEL = Object.prototype.hasOwnProperty.call(LEVEL_PARAMS, FIRST)
const LEVEL = FIRST_IS_LEVEL ? FIRST : "standard"
const TASK = (FIRST_IS_LEVEL ? RAW_ARGS.slice(FIRST.length).trim() : RAW_ARGS).trim()
const P = LEVEL_PARAMS[LEVEL]

if (!TASK) {
  return { error: "No task given. Pass args as \"<level> <task>\", e.g. \"standard add a --version flag to the CLI\"." }
}

// ─── Shared prompt fragments ───
const GROUNDING = `Explore the repository first — read enough of the relevant code and config to ground your work in what actually exists, and reuse existing utilities/patterns rather than inventing parallel ones. Cite path:line for load-bearing claims. Follow repo conventions, including British spelling in identifiers/output where the repo uses it. Apply YAGNI — no speculative scope.`

// ─── Schemas ───
const DESIGN_SCHEMA = {
  type: "object", required: ["recommendation"],
  properties: {
    recommendation: { type: "string", description: "the recommended approach, stated concretely" },
    rationale: { type: "string", description: "why this approach over the alternatives, and what is deliberately not being done" },
    risks: { type: "string", description: "the main risks or open questions, if any" },
  },
}
const PLAN_SCHEMA = {
  type: "object", required: ["steps"],
  properties: {
    steps: {
      type: "array",
      description: "steps grouped into ascending waves; a wave runs in parallel, so steps sharing a wave MUST be independent and touch DISJOINT files. Higher waves may depend on lower ones.",
      items: {
        type: "object", required: ["title", "change", "complexity", "wave"],
        properties: {
          title: { type: "string", description: "short imperative label" },
          files: { type: "array", items: { type: "string" }, description: "repo-relative files this step touches — used to guarantee waves are file-disjoint" },
          change: { type: "string", description: "the concrete change to make" },
          complexity: { enum: ["mechanical", "substantive"], description: "'mechanical' = rote edit a cheap model does reliably (rename, apply a settled pattern, boilerplate); 'substantive' = needs implementation judgement (non-trivial logic, decisions about how)" },
          wave: { type: "integer", description: "1-based wave number. Steps in the same wave run concurrently and must be independent + file-disjoint; a step that depends on another must be in a later wave." },
          verify: { type: "string", description: "how to confirm this step is correct" },
        },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: "object", required: ["verdict", "evidence"],
  properties: {
    verdict: { enum: ["pass", "needs-changes", "fail"] },
    evidence: { type: "string" },
    problems: { type: "string", description: "concrete problems, most important first, or 'none'" },
  },
}
const GIT_SCHEMA = {
  type: "object", required: ["isGit"],
  properties: { isGit: { type: "boolean", description: "true if the current directory is inside a git working tree" } },
}
const INTEGRATE_SCHEMA = {
  type: "object", required: ["merged"],
  properties: {
    merged: { type: "integer", description: "how many worktree branches were merged into the working branch" },
    conflict: { type: "string", description: "conflicting files if any merge failed, else 'none'" },
  },
}

// ─── Phase 1: Design (Fable) ───
phase("Design")
const designPrompt = angle =>
  "## Design task\n" + TASK + "\n\n" + GROUNDING + "\n\n" +
  (angle ? "Bias your thinking toward this angle: " + angle + ".\n\n" : "") +
  "Weigh 2-3 viable approaches with honest trade-offs, then commit to a single recommendation stated concretely enough to plan from. Structured output only."

let design
if (P.panel > 1) {
  const ANGLES = ["the simplest thing that could work (MVP-first)", "robustness and edge-case correctness", "fit with existing architecture and least disruption"]
  const candidates = (await parallel(
    Array.from({ length: P.panel }, (_, i) => () =>
      agent(designPrompt(ANGLES[i % ANGLES.length]), { label: "design:" + (i + 1), phase: "Design", model: "fable", effort: "high", agentType: "architect", schema: DESIGN_SCHEMA })
    )
  )).filter(Boolean)
  log("Design panel: " + candidates.length + " approaches proposed")
  if (candidates.length === 0) return { error: "Design phase produced no viable approach." }
  const block = candidates.map((c, i) => "### Approach [" + i + "]\nRecommendation: " + c.recommendation + "\nRationale: " + (c.rationale || "") + "\nRisks: " + (c.risks || "")).join("\n\n")
  design = await agent(
    "## Synthesis: pick the best design for this task\n" + TASK + "\n\n" +
    "You have " + candidates.length + " independently-proposed approaches. Judge them, then return ONE synthesized recommendation — the strongest single approach, grafting the best ideas from the others where they fit. " + GROUNDING + "\n\n" + block + "\n\nStructured output only.",
    { label: "design:synthesize", phase: "Design", model: "fable", effort: "max", agentType: "architect", schema: DESIGN_SCHEMA }
  )
} else {
  design = await agent(designPrompt(null), { label: "design", phase: "Design", model: "fable", effort: "high", agentType: "architect", schema: DESIGN_SCHEMA })
}
if (!design || !design.recommendation) return { error: "Design phase failed to produce a recommendation." }
log("Design settled: " + design.recommendation.slice(0, 120))

// ─── Phase 2: Plan (Fable) ───
phase("Plan")
const planResult = await agent(
  "## Turn this design into an implementation plan\nTask: " + TASK + "\n\n" +
  "Chosen approach: " + design.recommendation + "\n" + (design.rationale ? "Rationale: " + design.rationale + "\n" : "") + "\n" +
  GROUNDING + "\n\n" +
  "Produce at most " + P.maxSteps + " steps. For each: name the file(s), describe the concrete change, state what to verify, tag its complexity ('mechanical' = a rote edit a cheap model does reliably; 'substantive' = needs implementation judgement), and assign a 1-based WAVE number.\n\n" +
  "Waves are the parallelism unit: every step in the same wave runs CONCURRENTLY in a separate workspace, so steps sharing a wave MUST be independent and touch DISJOINT files. If step B depends on step A's changes, or they touch the same file, put B in a later wave. Pack genuinely independent steps into the same wave to maximise parallelism; keep dependent work in ascending waves. Leave no design judgement unresolved — 'substantive' means judgement about implementation, not about the design, which is already settled. Structured output only.",
  { label: "plan", phase: "Plan", model: "fable", effort: "high", agentType: "architect", schema: PLAN_SCHEMA }
)
const rawSteps = (planResult && Array.isArray(planResult.steps) ? planResult.steps : []).slice(0, P.maxSteps)
if (rawSteps.length === 0) {
  return { level: LEVEL, task: TASK, design, plan: [], results: [], review: null, summary: "Design produced no actionable steps; nothing implemented." }
}
// Attach a stable 1-based index and normalise the wave number.
const steps = rawSteps.map((s, i) => ({ ...s, idx: i, wave: Number.isInteger(s.wave) && s.wave > 0 ? s.wave : 1 }))
const waveNums = [...new Set(steps.map(s => s.wave))].sort((a, b) => a - b)
log("Plan: " + steps.length + " steps across " + waveNums.length + " wave(s)")

// ─── Is this a git repo? Worktree parallelism needs one; otherwise fall back. ───
phase("Implement")
const gitProbe = await agent(
  "Determine whether the current working directory is inside a git repository. Run `git rev-parse --is-inside-work-tree` and report the result. Structured output only.",
  { label: "git-check", phase: "Implement", model: "sonnet", agentType: "reader", schema: GIT_SCHEMA }
)
const isGit = !!(gitProbe && gitProbe.isGit)
log("git repo: " + (isGit ? "yes — worktree parallelism enabled" : "no — running sequentially in the shared tree"))

// ─── Implement → Integrate → Verify, one wave at a time ───
const substantiveOf = s => s.complexity === "substantive"
const implOpts = (s, wt) => {
  const base = substantiveOf(s)
    ? { label: "build:" + (s.idx + 1), phase: "Implement", model: "opus", agentType: "builder" }
    : { label: "impl:" + (s.idx + 1), phase: "Implement", model: "sonnet", agentType: "implementer" }
  return wt ? { ...base, isolation: "worktree" } : base
}
const implPrompt = (s, wt) => {
  const filesLine = s.files && s.files.length ? "Files: " + s.files.join(", ") + "\n" : ""
  const judgement = substantiveOf(s)
    ? "It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report a BLOCKER."
    : "Make exactly this change — no more, and no design judgement. If it is ambiguous or impossible as written, STOP and report a BLOCKER rather than guessing."
  const wtNote = wt
    ? "\n\nYou are working in an ISOLATED git worktree that runs in parallel with sibling steps. Your worktree may NOT contain in-progress changes from those siblings; if this step turns out to need code another step was to add and you cannot find it, STOP and report a BLOCKER rather than guessing. When the change is complete, COMMIT it in this worktree with a concise message describing the step (no attribution trailer)."
    : ""
  return "## Implementation step " + (s.idx + 1) + "/" + steps.length + " (wave " + s.wave + "): " + s.title + "\n" +
    "This is part of a larger task: " + TASK + "\n\n" + filesLine + "Change to make:\n" + s.change + "\n\n" +
    (s.verify ? "This step is done when: " + s.verify + "\n\n" : "") +
    judgement + " Match surrounding code and conventions. Report what you changed with path:line refs." + wtNote
}
const verifyOne = (s, impled) =>
  agent(
    "## Verify implementation step " + (s.idx + 1) + ": " + s.title + "\n" +
    "Intended change: " + s.change + "\n" + (s.verify ? "Done when: " + s.verify + "\n" : "") +
    "\nWhat the implementer reported:\n" + (impled || "(no report returned)") + "\n\n" +
    "Check the change against its STATED intent, sceptically. Prefer evidence — run the relevant test/build/lint if cheap and quote output bare. Return a verdict. Structured output only.",
    { label: "verify:" + (s.idx + 1), phase: "Verify", model: "sonnet", agentType: "verifier", schema: VERDICT_SCHEMA }
  )

const results = []
for (const w of waveNums) {
  const waveSteps = steps.filter(s => s.wave === w)
  // Worktree isolation only pays off for genuine parallelism in a git repo.
  const useWorktrees = isGit && waveSteps.length > 1

  phase("Implement")
  const impls = await parallel(waveSteps.map(s => () => agent(implPrompt(s, useWorktrees), implOpts(s, useWorktrees))))
  log("wave " + w + ": " + waveSteps.length + " step(s) implemented" + (useWorktrees ? " in parallel worktrees" : isGit ? " in the shared tree" : " sequentially (no git)"))

  // Integrate the wave's worktrees back into the working tree.
  let integration = null
  if (useWorktrees) {
    phase("Integrate")
    integration = await agent(
      "## Integrate wave " + w + " worktrees\n" +
      "Several implementation steps just ran IN PARALLEL, each in its own git worktree under `.claude/worktrees/`, and each committed its change on its own branch. They were designed to touch DISJOINT files, so the merges must be conflict-free.\n\n" +
      "The steps in this wave and the files each was to touch:\n" +
      waveSteps.map(s => "- " + s.title + (s.files && s.files.length ? " → " + s.files.join(", ") : " → (unspecified)")).join("\n") + "\n\n" +
      "Do exactly this, from the main working tree (not a worktree):\n" +
      "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on.\n" +
      "2. For each such worktree whose branch has commits ahead of the current branch, merge that branch into the current working branch with `git merge --no-ff <branch>`.\n" +
      "3. If any merge reports a conflict, run `git merge --abort` and STOP: report the conflicting files as a BLOCKER (a conflict means the steps were not actually file-disjoint). Do not try to resolve it.\n" +
      "4. After each clean merge, remove that worktree with `git worktree remove <path>` and delete its now-merged branch.\n\n" +
      "Report how many branches you merged and any conflict. Structured output only.",
      { label: "integrate:w" + w, phase: "Integrate", model: "sonnet", agentType: "implementer", schema: INTEGRATE_SCHEMA }
    )
    log("wave " + w + " integrated: " + (integration ? integration.merged + " branch(es) merged" + (integration.conflict && integration.conflict !== "none" ? ", CONFLICT: " + integration.conflict : "") : "integrator returned nothing"))
  }

  // Verify each step of the wave against its intent (now in the integrated tree).
  phase("Verify")
  const verds = await parallel(waveSteps.map((s, k) => () => verifyOne(s, impls[k])))
  waveSteps.forEach((s, k) => {
    const v = verds[k]
    results.push({
      step: s.title, wave: w, tier: substantiveOf(s) ? "opus" : "sonnet", worktree: useWorktrees,
      implemented: impls[k], verdict: v ? v.verdict : "unknown", evidence: v ? v.evidence : "", problems: v ? v.problems : "",
      integrationConflict: useWorktrees && integration && integration.conflict && integration.conflict !== "none" ? integration.conflict : undefined,
    })
    log("step " + (s.idx + 1) + "/" + steps.length + " [" + (substantiveOf(s) ? "opus" : "sonnet") + "] (" + s.title + "): " + (v ? v.verdict : "unknown"))
  })
}

// ─── Final deep review (Fable) ───
phase("Final Review")
const changed = results.map((r, i) => "### Step " + (i + 1) + " (wave " + r.wave + "): " + r.step + "\nPer-step verdict: " + r.verdict + "\nImplementer report: " + (r.implemented || "").slice(0, 800)).join("\n\n")
const review = await agent(
  "## Final whole-change review\nTask: " + TASK + "\n\n" +
  "Chosen approach: " + design.recommendation + "\n\n" +
  "The change was built in " + steps.length + " steps across " + waveNums.length + " wave(s) — independent steps ran in parallel and were merged back — each already checked by a per-step verifier. Do the DEEP, cross-cutting review the per-step checks cannot: subtle correctness, interactions between the changed parts (especially across steps that were built in isolation and merged), whether the change as a whole achieves the intent and fits the architecture. Read the actual files in the working tree; do not rely only on the reports below. Prefer evidence — run tests/build/lint if cheap and quote output bare.\n\n" + changed + "\n\n" +
  "Return a verdict for the whole change. Structured output only.",
  { label: "final-review", phase: "Final Review", model: "fable", effort: "high", agentType: "deep-reviewer", schema: VERDICT_SCHEMA }
)

const failed = results.filter(r => r.verdict === "fail" || r.verdict === "needs-changes").length
return {
  level: LEVEL,
  task: TASK,
  gitWorktrees: isGit,
  design,
  plan: steps.map(s => ({ title: s.title, files: s.files, change: s.change, complexity: s.complexity, wave: s.wave })),
  results,
  review: review || null,
  summary: "Tiered build of \"" + TASK + "\": " + steps.length + " steps across " + waveNums.length + " wave(s)" + (isGit ? " (parallel worktrees)" : " (sequential, no git)") + ", " + (steps.length - failed) + " passed per-step, final review verdict: " + (review ? review.verdict : "unknown") + ".",
}
