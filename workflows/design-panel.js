export const meta = {
  name: "design-panel",
  description: "Refine a rough plan (drafted with the user during brainstorming) into a numbered, wave-grouped, dispatchable implementation plan. The coordinator chooses the architect composition via panelModels — a single Opus/Fable architect, an all-Opus/all-Fable/mixed panel, or the two-tier pattern (an Opus panel then a ≥Opus integrator, optionally Fable) — or omits it and a cheap Sonnet composer picks. It does NOT design from a blank slate; it refines what the user and coordinator already shaped.",
  whenToUse: "Invoked by the tiered-development skill. Pass args as an object: { level, task, roughPlan, panelModels?, integratorModel? } — level is 'quick' | 'standard' | 'deep'; panelModels is a 1–5 array of 'opus'/'fable'; integratorModel ('opus'|'fable', never Sonnet) runs the final plan integrator. Omit panelModels/integratorModel to let a Sonnet composer choose. Returns { design, plan }.",
  phases: [
    { title: "Compose", detail: "Only when the composition is unspecified: a Sonnet composer picks the panel models + integrator", model: "sonnet" },
    { title: "Refine", detail: "Architect(s) (Opus and/or Fable) refine the rough plan into a design summary + a numbered, wave-grouped plan" },
    { title: "Integrate", detail: "When >1 candidate (or an integrator is set): a ≥Opus architect merges the panel's candidate plans into one" },
  ],
}

// ─── Args ───
// `args` may arrive as a parsed object or as a JSON string depending on the
// harness — normalise to an object either way.
let A = args
if (typeof A === "string") { try { A = JSON.parse(A) } catch { A = {} } }
if (!A || typeof A !== "object") A = {}
const LEVEL = ["quick", "standard", "deep"].includes(A.level) ? A.level : "standard"
const TASK = typeof A.task === "string" ? A.task.trim() : ""
const ROUGH = typeof A.roughPlan === "string" ? A.roughPlan.trim() : ""
if (!TASK) return { error: "No task given. Pass args as { level, task, roughPlan }." }
const MAX_STEPS = LEVEL === "deep" ? 16 : LEVEL === "quick" ? 6 : 10

// Design/plan-integrator models are the thinking tiers: Opus or Fable ONLY (never
// Sonnet). Fable is the premium tier — spend it sparingly. Validate anything the
// coordinator supplies and scream on a bad value rather than guessing.
const MODEL_SET = ["opus", "fable"]
const validModelList = a => Array.isArray(a) && a.length >= 1 && a.length <= 5 && a.every(m => MODEL_SET.includes(m))
let panelModels = A.panelModels
let integratorModel = A.integratorModel
const panelSpecified = panelModels !== undefined && panelModels !== null
const integSpecified = integratorModel !== undefined && integratorModel !== null && integratorModel !== ""
if (panelSpecified && !validModelList(panelModels)) {
  return { error: "design-panel: `panelModels` must be a non-empty array (≤5) of 'opus'/'fable', got " + JSON.stringify(A.panelModels) + "." }
}
if (integSpecified && !MODEL_SET.includes(integratorModel)) {
  return { error: "design-panel: `integratorModel` (the plan integrator) must be 'opus' or 'fable' — never Sonnet — got " + JSON.stringify(A.integratorModel) + "." }
}

// Agent types are registered under the plugin namespace (e.g. "tiered-development:architect"),
// so `agentType` must carry the prefix — the bare name is not found.
const NS = "tiered-development:"

// ─── Shared prompt fragments ───
const GROUNDING = `Explore the repository first — read enough of the relevant code and config to ground your work in what actually exists, and reuse existing utilities/patterns rather than inventing parallel ones. Cite path:line for load-bearing claims. Follow repo conventions, including British spelling in identifiers/output where the repo uses it. Apply YAGNI — no speculative scope.`
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Return only the structured output — no preamble, no restating this prompt. Cut filler/hedging/praise. path:line on every code claim. Keep verbatim: error strings, commands, identifiers, and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
const TIERS_DESC = "'menial' = a cheap edit that is obvious if wrong (rename, boilerplate, cosmetic) — a Haiku does it reliably; 'mechanical' = routine work with settled instructions, for Sonnet; 'substantive' = needs implementation judgement (non-trivial logic, decisions about how), for Opus"

// ─── Schemas ───
const COMPOSE_SCHEMA = {
  type: "object", required: ["panelModels"],
  properties: {
    panelModels: { type: "array", items: { enum: ["opus", "fable"] }, description: "1–5 models, one per architect; Opus by default, a Fable panelist only for high-complexity/high-impact work (a hard algorithm's core, deep bug-hunts, blast-radius analysis)" },
    integratorModel: { enum: ["opus", "fable"], description: "model for the plan integrator that merges the aspect-refined plans — ≥Opus, never Sonnet; defaults to the top tier in the panel, so make it 'fable' whenever a panelist is Fable" },
    rationale: { type: "string", description: "one line on the composition chosen" },
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
          complexity: { enum: ["menial", "mechanical", "substantive"], description: TIERS_DESC },
          wave: { type: "integer", description: "1-based wave number. Steps in the same wave run concurrently and must be independent + file-disjoint; a step that depends on another must be in a later wave." },
          verify: { type: "string", description: "how to confirm this step is correct" },
        },
      },
    },
  },
}

const roughBlock = ROUGH ? "\n\nRough plan drafted with the user (refine THIS — do not start over):\n" + ROUGH + "\n" : "\n\n(No rough plan supplied — derive the plan from the task.)\n"

const ASPECTS = [
  "correctness & edge-case handling",
  "architecture, interfaces & reuse of existing code over new",
  "wave decomposition — step independence, file-disjointness, ordering & dependencies",
  "verification — how each step is proven correct",
  "risk & impact — blast radius, what could break, migration/rollback",
]
const refinePrompt = aspect =>
  "## Refine into an implementation plan\nTask: " + TASK + roughBlock + "\n" +
  (aspect
    ? "You are one of several architects refining this plan IN PARALLEL, and you OWN one aspect of it: **" + aspect + "**. Work that aspect out thoroughly and correctly across the whole plan; leave the other aspects at a sound baseline — a separate integrator will merge your aspect's strengths with the others'. The whole rough plan above is your context.\n\n"
    : "\n") +
  GROUNDING + "\n\n" +
  "Turn the rough plan into a concrete plan of at most " + MAX_STEPS + " steps. For each step: name the file(s), describe the concrete change, state what to verify, tag its complexity (" + TIERS_DESC + "), and assign a 1-based WAVE number. Choose the complexity by weighing the judgement the step needs against the cost of getting it wrong.\n\n" +
  "Waves are the parallelism unit: every step in the same wave runs CONCURRENTLY in a separate workspace, so steps sharing a wave MUST be independent and touch DISJOINT files. If step B depends on step A, or they touch the same file, put B in a later wave. Pack genuinely independent steps into the same wave. Leave NO design judgement unresolved downstream — 'substantive' means judgement about implementation, not about the design, which is settled here. Also return recommendation/rationale/risks as a short design summary.\n\n" +
  "If the rough plan is internally contradictory or its premise is wrong given the code, STOP and return that as a BLOCKER instead of a plan.\n\n" + COMMS

// ─── Compose: pick the architect composition when the coordinator did not ───
if (!panelSpecified) {
  phase("Compose")
  const picked = await agent(
    "## Choose the architect composition for this design\nTask: " + TASK + roughBlock + "\n" +
    "Decide who should refine this plan. On a multi-member panel each architect OWNS one aspect (correctness, architecture, decomposition, verification, risk); a single member does the whole refinement. Return `panelModels` — 1–5 entries of 'opus'/'fable', one architect each — and optionally `integratorModel` ('opus'/'fable') for the step that merges the aspect-refined plans into the final one.\n\n" +
    "Guidance: Opus is the default thinking tier and handles most designs well. Fable is stronger but bills extra — reach for it (a Fable panelist and/or a Fable integrator) only for HIGH-COMPLEXITY or HIGH-IMPACT work: the core of a hard algorithm, deep analysis of a large/existing codebase, hunting subtle long-standing bugs, or tracing the blast radius of a decision. A single ['opus'] suits a routine refinement; a 2–3 panel divides the plan into aspects. If you put Fable on the panel to own a hard aspect, set `integratorModel` to 'fable' too so its contribution is merged by an equal (the integrator defaults to the top tier in the panel). The integrator is ≥Opus, NEVER Sonnet.\n\n" +
    "You are only CHOOSING models — you do not design anything.\n\n" + COMMS,
    { label: "compose", phase: "Compose", model: "sonnet", schema: COMPOSE_SCHEMA }
  )
  if (picked && validModelList(picked.panelModels)) panelModels = picked.panelModels
  if (!integSpecified && picked && MODEL_SET.includes(picked.integratorModel)) integratorModel = picked.integratorModel
  log("Composer: panel=[" + (Array.isArray(panelModels) ? panelModels.join(",") : "?") + "] integrator=" + (integratorModel || "opus") + (picked && picked.rationale ? " — " + picked.rationale : ""))
}
// Static fallback (composer omitted or failed): spend Fable sparingly.
if (!validModelList(panelModels)) panelModels = LEVEL === "deep" ? ["fable", "opus", "fable"] : ["opus"]
// Integrator defaults to the top tier PRESENT in the panel (never below Opus): once
// a Fable panelist owns a hard aspect, a Fable integrator merges it as an equal.
if (!MODEL_SET.includes(integratorModel)) integratorModel = panelModels.includes("fable") ? "fable" : "opus"

// ─── Refine ───
// A multi-member panel divides the labour: each architect OWNS one aspect of the
// plan (with the whole rough plan for context), rather than every member redundantly
// re-refining the entire thing. A single member does the full refinement.
phase("Refine")
const multi = panelModels.length > 1
const aspectsUsed = panelModels.map((m, i) => multi ? ASPECTS[i % ASPECTS.length] : null)
const raw = await parallel(
  panelModels.map((m, i) => () =>
    agent(refinePrompt(aspectsUsed[i]), { label: "refine:" + (i + 1), phase: "Refine", model: m, effort: "high", agentType: NS + "architect", schema: PLAN_SCHEMA })
  )
)
const candidates = []
raw.forEach((r, i) => { if (r) { r._aspect = aspectsUsed[i]; candidates.push(r) } })
log("Panel: " + candidates.length + " aspect-refined plan(s) [" + panelModels.join(",") + "]")
if (candidates.length === 0) return { error: "Refinement produced no candidate plan." }

// ─── Integrate: merge the aspect-refined plans into one coherent plan (≥Opus) ───
let refined
if (candidates.length > 1 || integSpecified) {
  phase("Integrate")
  const block = candidates.map((c, i) =>
    "### Plan [" + i + "]" + (c._aspect ? " — aspect owned: " + c._aspect : "") + "\nRecommendation: " + (c.recommendation || "") + "\nRisks: " + (c.risks || "") + "\nSteps:\n" +
    (Array.isArray(c.steps) ? c.steps : []).map((s, k) => "  " + (k + 1) + ". (wave " + s.wave + ", " + s.complexity + ") " + s.title + " — " + s.change + (s.files && s.files.length ? " [" + s.files.join(", ") + "]" : "")).join("\n")
  ).join("\n\n")
  const aspectsLine = candidates.map(c => c._aspect).filter(Boolean).join("; ")
  refined = await agent(
    "## Integrate the aspect-refined plans into ONE\nTask: " + TASK + roughBlock + "\n" +
    "You have " + candidates.length + " plan(s)" + (aspectsLine ? ", each refined by a specialist who OWNED one aspect (" + aspectsLine + ")" : "") + ". Merge them into ONE coherent plan that carries each aspect's strongest contribution — the correctness specialist's edge-case steps, the architecture specialist's structure/reuse, the decomposition specialist's waving, the verification specialist's checks, and so on — resolving any conflicts between them. Keep it to at most " + MAX_STEPS + " steps, correctly waved (same-wave steps independent + file-disjoint), each step tagged with complexity (" + TIERS_DESC + "). " + GROUNDING + "\n\n" + block + "\n\n" + COMMS,
    { label: "integrate", phase: "Integrate", model: integratorModel, effort: "max", agentType: NS + "architect", schema: PLAN_SCHEMA }
  )
} else {
  refined = candidates[0]
}

if (!refined || !Array.isArray(refined.steps) || refined.steps.length === 0) {
  return { error: "Refinement failed to produce steps.", design: refined ? { recommendation: refined.recommendation, rationale: refined.rationale, risks: refined.risks } : null, plan: [] }
}

// Attach a stable 1-based index; normalise wave number and complexity (three tiers).
const TIERS = ["menial", "mechanical", "substantive"]
const steps = refined.steps.slice(0, MAX_STEPS).map((s, i) => ({
  idx: i,
  title: s.title,
  files: Array.isArray(s.files) ? s.files : [],
  change: s.change,
  complexity: TIERS.includes(s.complexity) ? s.complexity : "mechanical",
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
