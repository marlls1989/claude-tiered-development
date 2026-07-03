export const meta = {
  name: "design-panel",
  description: "Refine a rough plan (drafted with the user during brainstorming) into a numbered, wave-grouped, dispatchable implementation plan. Fable architect(s) do the refinement; 'deep' runs a 3-architect panel + synthesis. Called by the tiered-development skill between its brainstorm step and its approval gate — it does NOT design from a blank slate, it refines what the user and coordinator already shaped.",
  whenToUse: "Invoked by the tiered-development skill. Pass args as an object: { level, task, roughPlan } — level is 'quick' | 'standard' | 'deep'; task is the free-form task; roughPlan is the approach + rough steps from brainstorming. Returns { design, plan }.",
  phases: [
    { title: "Refine", detail: "Fable architect(s) refine the rough plan into a design summary + a numbered, wave-grouped plan", model: "fable" },
    { title: "Synthesis", detail: "deep only: a Fable architect merges the panel's candidate plans into one", model: "fable" },
  ],
}

// ─── Args ───
const A = (args && typeof args === "object") ? args : {}
const LEVEL = ["quick", "standard", "deep"].includes(A.level) ? A.level : "standard"
const TASK = typeof A.task === "string" ? A.task.trim() : ""
const ROUGH = typeof A.roughPlan === "string" ? A.roughPlan.trim() : ""
if (!TASK) return { error: "No task given. Pass args as { level, task, roughPlan }." }
const PANEL = LEVEL === "deep" ? 3 : 1
const MAX_STEPS = LEVEL === "deep" ? 16 : LEVEL === "quick" ? 6 : 10

// ─── Shared prompt fragments ───
const GROUNDING = `Explore the repository first — read enough of the relevant code and config to ground your work in what actually exists, and reuse existing utilities/patterns rather than inventing parallel ones. Cite path:line for load-bearing claims. Follow repo conventions, including British spelling in identifiers/output where the repo uses it. Apply YAGNI — no speculative scope.`
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Return only the structured output — no preamble, no restating this prompt. Cut filler/hedging/praise. path:line on every code claim. Keep verbatim: error strings, commands, identifiers, and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`

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
    recommendation: { type: "string", description: "the settled approach in one or two sentences, for the design summary" },
    rationale: { type: "string", description: "why this approach; what is deliberately out of scope" },
    risks: { type: "string", description: "main risks or open questions, or 'none'" },
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

const roughBlock = ROUGH ? "\n\nRough plan drafted with the user (refine THIS — do not start over):\n" + ROUGH + "\n" : "\n\n(No rough plan supplied — derive the plan from the task.)\n"

const refinePrompt = angle =>
  "## Refine into an implementation plan\nTask: " + TASK + roughBlock + "\n" +
  (angle ? "Bias your refinement toward this angle: " + angle + ".\n\n" : "\n") +
  GROUNDING + "\n\n" +
  "Turn the rough plan into a concrete plan of at most " + MAX_STEPS + " steps. For each step: name the file(s), describe the concrete change, state what to verify, tag its complexity ('mechanical' = a rote edit a cheap model does reliably; 'substantive' = needs implementation judgement), and assign a 1-based WAVE number.\n\n" +
  "Waves are the parallelism unit: every step in the same wave runs CONCURRENTLY in a separate workspace, so steps sharing a wave MUST be independent and touch DISJOINT files. If step B depends on step A, or they touch the same file, put B in a later wave. Pack genuinely independent steps into the same wave. Leave NO design judgement unresolved downstream — 'substantive' means judgement about implementation, not about the design, which is settled here. Also return recommendation/rationale/risks as a short design summary.\n\n" +
  "If the rough plan is internally contradictory or its premise is wrong given the code, STOP and return that as a BLOCKER instead of a plan.\n\n" + COMMS

// ─── Refine ───
phase("Refine")
let refined
if (PANEL > 1) {
  const ANGLES = ["the simplest thing that could work (MVP-first)", "robustness and edge-case correctness", "fit with existing architecture and least disruption"]
  const candidates = (await parallel(
    Array.from({ length: PANEL }, (_, i) => () =>
      agent(refinePrompt(ANGLES[i % ANGLES.length]), { label: "refine:" + (i + 1), phase: "Refine", model: "fable", effort: "high", agentType: "architect", schema: PLAN_SCHEMA })
    )
  )).filter(Boolean)
  log("Panel: " + candidates.length + " candidate plans")
  if (candidates.length === 0) return { error: "Refinement produced no candidate plan." }

  phase("Synthesis")
  const block = candidates.map((c, i) =>
    "### Candidate [" + i + "]\nRecommendation: " + (c.recommendation || "") + "\nRisks: " + (c.risks || "") + "\nSteps:\n" +
    (Array.isArray(c.steps) ? c.steps : []).map((s, k) => "  " + (k + 1) + ". (wave " + s.wave + ", " + s.complexity + ") " + s.title + " — " + s.change + (s.files && s.files.length ? " [" + s.files.join(", ") + "]" : "")).join("\n")
  ).join("\n\n")
  refined = await agent(
    "## Synthesise one plan from the panel\nTask: " + TASK + roughBlock + "\n" +
    "You have " + candidates.length + " independently-refined candidate plans. Judge them, then return ONE synthesised plan — the strongest single plan, grafting the best steps/ordering from the others where they fit. Keep it to at most " + MAX_STEPS + " steps, correctly waved (same-wave steps independent + file-disjoint). " + GROUNDING + "\n\n" + block + "\n\n" + COMMS,
    { label: "synthesise", phase: "Synthesis", model: "fable", effort: "max", agentType: "architect", schema: PLAN_SCHEMA }
  )
} else {
  refined = await agent(refinePrompt(null), { label: "refine", phase: "Refine", model: "fable", effort: "high", agentType: "architect", schema: PLAN_SCHEMA })
}

if (!refined || !Array.isArray(refined.steps) || refined.steps.length === 0) {
  return { error: "Refinement failed to produce steps.", design: refined ? { recommendation: refined.recommendation, rationale: refined.rationale, risks: refined.risks } : null, plan: [] }
}

// Attach a stable 1-based index and normalise the wave number.
const steps = refined.steps.slice(0, MAX_STEPS).map((s, i) => ({
  idx: i,
  title: s.title,
  files: Array.isArray(s.files) ? s.files : [],
  change: s.change,
  complexity: s.complexity === "substantive" ? "substantive" : "mechanical",
  wave: Number.isInteger(s.wave) && s.wave > 0 ? s.wave : 1,
  verify: s.verify || "",
}))
const waveNums = [...new Set(steps.map(s => s.wave))].sort((a, b) => a - b)
log("Plan: " + steps.length + " steps across " + waveNums.length + " wave(s)")

return {
  level: LEVEL,
  task: TASK,
  design: { recommendation: refined.recommendation || "", rationale: refined.rationale || "", risks: refined.risks || "" },
  plan: steps,
  waves: waveNums,
}
