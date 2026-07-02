export const meta = {
  name: "tiered-development",
  description: "Three-tier delegation pipeline: Fable designs the approach and the plan, Opus implements the substantive steps while Sonnet handles the mechanical ones and verifies each, Fable does the final deep review. The autonomous (no approval gate) counterpart to the tiered-development skill.",
  whenToUse: "When the user explicitly wants a non-trivial change designed and built hands-off across model tiers. Pass args as \"<level> <task>\" — level is quick, standard, or deep (default standard); task is the free-form description of what to build (e.g. \"deep add a --json output mode to the report command\"). It CANNOT pause for approval — use the tiered-development skill when the user wants to approve the plan first.",
  phases: [
    { title: "Design", detail: "Fable architect(s) weigh approaches and recommend one; deep level runs a panel + synthesis", model: "fable" },
    { title: "Plan", detail: "Fable architect turns the recommendation into a numbered, dispatchable plan", model: "fable" },
    { title: "Implement", detail: "Opus builder does substantive steps, Sonnet implementer does mechanical ones — each in order in the shared tree", model: "opus" },
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
      description: "ordered steps; step N may depend on steps before it, so order is the dependency order",
      items: {
        type: "object", required: ["title", "change", "complexity"],
        properties: {
          title: { type: "string", description: "short imperative label" },
          files: { type: "array", items: { type: "string" }, description: "repo-relative files this step touches" },
          change: { type: "string", description: "the concrete change to make" },
          complexity: { enum: ["mechanical", "substantive"], description: "'mechanical' = rote edit a cheap model does reliably (rename, apply a settled pattern, boilerplate); 'substantive' = needs implementation judgement (non-trivial logic, decisions about how)" },
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
  "Produce at most " + P.maxSteps + " ordered steps. For each: name the file(s), describe the concrete change, state what to verify, and tag its complexity — 'mechanical' (a rote edit a cheap model does reliably: rename, apply a settled pattern, boilerplate) or 'substantive' (needs implementation judgement: non-trivial logic, decisions about how). Leave no design judgement unresolved — 'substantive' means judgement about implementation, not about the design, which is already settled. Order the steps so each depends only on the ones before it. Structured output only.",
  { label: "plan", phase: "Plan", model: "fable", effort: "high", agentType: "architect", schema: PLAN_SCHEMA }
)
const steps = (planResult && Array.isArray(planResult.steps) ? planResult.steps : []).slice(0, P.maxSteps)
if (steps.length === 0) {
  return { level: LEVEL, task: TASK, design, plan: [], results: [], review: null, summary: "Design produced no actionable steps; nothing implemented." }
}
log("Plan: " + steps.length + " steps")

// ─── Phases 3+4: Implement (Sonnet) → Verify (Sonnet), sequential in the shared tree ───
// Steps mutate a shared working tree and later steps may depend on earlier edits,
// so they run in order — NOT in parallel — with a per-step verifier after each.
const results = []
for (let i = 0; i < steps.length; i++) {
  const s = steps[i]
  const filesLine = s.files && s.files.length ? "Files: " + s.files.join(", ") + "\n" : ""
  // Route by complexity: substantive steps → Opus builder (implementation
  // judgement); mechanical steps → Sonnet implementer (rote execution).
  const substantive = s.complexity === "substantive"
  const head =
    "## Implementation step " + (i + 1) + "/" + steps.length + ": " + s.title + "\n" +
    "This is part of a larger task: " + TASK + "\n\n" +
    filesLine + "Change to make:\n" + s.change + "\n\n" +
    (s.verify ? "This step is done when: " + s.verify + "\n\n" : "")
  const tail = substantive
    ? "Realise this step in the working tree. It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report that as a BLOCKER. Match surrounding code and conventions. Report what you changed with path:line refs."
    : "Make exactly this change in the working tree — no more, and no design judgement. Match surrounding code and conventions. If the step is ambiguous or cannot be done as written, STOP and report back as a BLOCKER rather than guessing. Report what you changed with path:line refs."
  phase("Implement")
  const impled = await agent(head + tail, substantive
    ? { label: "build:" + (i + 1), phase: "Implement", model: "opus", agentType: "builder" }
    : { label: "impl:" + (i + 1), phase: "Implement", model: "sonnet", agentType: "implementer" })
  phase("Verify")
  const verdict = await agent(
    "## Verify implementation step " + (i + 1) + ": " + s.title + "\n" +
    "Intended change: " + s.change + "\n" +
    (s.verify ? "Done when: " + s.verify + "\n" : "") +
    "\nWhat the implementer reported:\n" + (impled || "(no report returned)") + "\n\n" +
    "Check the change against its STATED intent, sceptically. Prefer evidence — run the relevant test/build/lint if cheap and quote output bare. Return a verdict. Structured output only.",
    { label: "verify:" + (i + 1), phase: "Verify", model: "sonnet", agentType: "verifier", schema: VERDICT_SCHEMA }
  )
  const tier = substantive ? "opus" : "sonnet"
  results.push({ step: s.title, tier, implemented: impled, verdict: verdict ? verdict.verdict : "unknown", evidence: verdict ? verdict.evidence : "", problems: verdict ? verdict.problems : "" })
  log("step " + (i + 1) + "/" + steps.length + " [" + tier + "] (" + s.title + "): " + (verdict ? verdict.verdict : "unknown"))
}

// ─── Phase 5: Final deep review (Fable) ───
phase("Final Review")
const changed = results.map((r, i) => "### Step " + (i + 1) + ": " + r.step + "\nPer-step verdict: " + r.verdict + "\nImplementer report: " + (r.implemented || "").slice(0, 800)).join("\n\n")
const review = await agent(
  "## Final whole-change review\nTask: " + TASK + "\n\n" +
  "Chosen approach: " + design.recommendation + "\n\n" +
  "The change was built in " + steps.length + " steps, each already checked by a per-step verifier. Do the DEEP, cross-cutting review the per-step checks cannot: subtle correctness, interactions between the changed parts, whether the change as a whole achieves the intent and fits the architecture. Read the actual files in the working tree; do not rely only on the reports below. Prefer evidence — run tests/build/lint if cheap and quote output bare.\n\n" + changed + "\n\n" +
  "Return a verdict for the whole change. Structured output only.",
  { label: "final-review", phase: "Final Review", model: "fable", effort: "high", agentType: "deep-reviewer", schema: VERDICT_SCHEMA }
)

const failed = results.filter(r => r.verdict === "fail" || r.verdict === "needs-changes").length
return {
  level: LEVEL,
  task: TASK,
  design,
  plan: steps.map(s => ({ title: s.title, files: s.files, change: s.change, complexity: s.complexity })),
  results,
  review: review || null,
  summary: "Tiered build of \"" + TASK + "\": " + steps.length + " steps implemented (" + (steps.length - failed) + " passed per-step), final review verdict: " + (review ? review.verdict : "unknown") + ".",
}
