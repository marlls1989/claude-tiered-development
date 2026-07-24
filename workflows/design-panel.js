export const meta = {
  name: "design-panel",
  description: "Refine a rough plan (drafted with the user during brainstorming) into a numbered, wave-grouped, dispatchable implementation plan with explicit inter-step dependsOn dependencies and a project greenBar (the build/test/lint command(s) that define a green tree). By default a cheap Sonnet composer picks the architect composition (Sonnet-admissible for a lighter aspect); it also assigns each panelist its task-relevant aspect on a multi-member panel. The integrator tier is deferred until after the panel fans out — it defaults to Opus and escalates to Fable when the panel flags high integration difficulty, then climbs a Sonnet→Opus→Fable ladder if it cannot reconcile. The coordinator overrides via panelModels — a single Sonnet/Opus/Fable architect, a mixed panel, or the two-tier pattern (a panel then a named integrator) — only when the user asks for a specific one. It does NOT design from a blank slate; it refines what the user and coordinator already shaped.",
  whenToUse: "Invoked by the tiered-development skill. Pass args as an object: { level, task, roughPlan, guidelines?, panelModels?, integratorModel? } — level is 'quick' | 'standard' | 'deep'; panelModels is a 1–5 array of 'opus'/'fable'/'sonnet'; integratorModel ('opus'|'fable'|'sonnet') runs the final plan integrator. Omit panelModels to let a Sonnet composer choose; omit integratorModel to defer the tier until after the panel fans out (Opus by default, Fable when the panel flags high integration difficulty). Even with a fixed multi-member panel the composer still assigns the per-panelist aspects. Returns { design, plan, waves, greenBar }.",
  phases: [
    { title: "Compose", detail: "A Sonnet composer picks the panel models when unspecified, and — even for a fixed panel — assigns the ordered, task-relevant aspects across a multi-member panel", model: "sonnet" },
    { title: "Refine", detail: "Architect(s) (Sonnet, Opus and/or Fable) refine the rough plan into a design summary + a numbered, wave-grouped plan" },
    { title: "Integrate", detail: "When >1 candidate: an architect merges the panel's candidate plans into one, climbing a Sonnet→Opus→Fable escalation ladder if it cannot reconcile" },
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
// Standing, project-wide rules the coordinator forwards verbatim from the project's guidelines file
// (`GUIDELINES.md`) so it never has to restate them per task. Injected into
// every agent that designs, writes, or judges code — never summarised, since they are requirements.
const GUIDELINES = typeof A.guidelines === "string" ? A.guidelines.trim() : ""
if (!TASK) return { error: "No task given. Pass args as { level, task, roughPlan }." }
const MAX_STEPS = LEVEL === "deep" ? 16 : LEVEL === "quick" ? 6 : 10

// Panel/integrator models now span the tiers: Sonnet is admissible on the panel (the
// composer may assign it a lighter aspect) and as an explicit integrator, and the
// deferred integrator escalates Sonnet→Opus→Fable when it cannot reconcile. Fable is
// the premium tier — spend it sparingly. Validate anything the coordinator supplies
// and scream on a bad value rather than guessing.
const MODEL_SET = ["opus", "fable", "sonnet"]
const validModelList = a => Array.isArray(a) && a.length >= 1 && a.length <= 5 && a.every(m => MODEL_SET.includes(m))
let panelModels = A.panelModels
let integratorModel = A.integratorModel
const panelSpecified = panelModels !== undefined && panelModels !== null
const integSpecified = integratorModel !== undefined && integratorModel !== null && integratorModel !== ""
if (panelSpecified && !validModelList(panelModels)) {
  return { error: "design-panel: `panelModels` must be a non-empty array (≤5) of 'opus'/'fable'/'sonnet', got " + JSON.stringify(A.panelModels) + "." }
}
if (integSpecified && !MODEL_SET.includes(integratorModel)) {
  return { error: "design-panel: `integratorModel` (the plan integrator) must be 'opus', 'fable', or 'sonnet', got " + JSON.stringify(A.integratorModel) + "." }
}

// Agent types are registered under the plugin namespace (e.g. "tiered-development:architect"),
// so `agentType` must carry the prefix — the bare name is not found.
const NS = "tiered-development:"

// ─── Resilient agent call ───
// A schema-carrying agent() THROWS when the worker never produces valid StructuredOutput
// ('StructuredOutput retry cap (5) exceeded'). That must degrade to a design-level failure in
// the returned shape, never crash the whole Workflow. Returns the agent's result, or null
// after recording the crash reason in agentCrash. agentCrash is reset per call and is safe
// only because every safeAgent call is individually awaited — never use it inside parallel().
let agentCrash = null
const safeAgent = async (prompt, opts) => {
  agentCrash = null
  try { return await agent(prompt, opts) } catch (e) {
    agentCrash = e && e.message ? String(e.message) : String(e)
    log((opts && opts.label ? opts.label : "agent") + " CRASHED: " + agentCrash)
    return null
  }
}

// ─── Shared prompt fragments ───
const GROUNDING = `Explore the repository first — read enough of the relevant code and config to ground your work in what actually exists, and reuse existing utilities/patterns rather than inventing parallel ones. Cite path:line for load-bearing claims. Follow repo conventions, including British spelling in identifiers/output where the repo uses it. Apply YAGNI — no speculative scope.`
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Return only the structured output — no preamble, no restating this prompt. Cut filler/hedging/praise. path:line on every code claim. Keep verbatim: error strings, commands, identifiers, and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
const GUIDELINES_BLOCK = GUIDELINES
  ? "\n\n## Project guidelines — standing rules for this repository\n" +
    "These come from the project's committed GUIDELINES.md and apply to EVERY task here, not only this one. They are HARD REQUIREMENTS: follow them as written, and do not ask the coordinator to repeat them.\n" +
    "You may NOT decide to break one. If your instructions above cannot be carried out without violating a guideline, that is a BLOCKER, not a judgement call: STOP, do NOT implement a violating version, and report it through your ask-back channel — name the guideline, state exactly what conflicts with it, why you can see no compliant way to do the task, and what you would do if authorised. Only the USER authorises a violation, via the coordinator. A violation is a last resort someone else signs off, never a call you make and mention afterwards.\n\n" +
    GUIDELINES + "\n\n— end of project guidelines —\n"
  : ""
const TIERS_DESC = "'menial' = a cheap edit that is obvious if wrong (rename, boilerplate, cosmetic) — a Haiku does it reliably; 'mechanical' = routine work with settled instructions, for Sonnet; 'substantive' = needs implementation judgement (non-trivial logic, decisions about how), for Opus"

const ASPECTS = [
  "correctness & edge-case handling",
  "architecture, interfaces & reuse of existing code over new",
  "wave decomposition — deliverable slicing, explicit dependencies & ordering",
  "verification — how each step is proven correct",
  "risk & impact — blast radius, what could break, migration/rollback",
]

// ─── Schemas ───
const COMPOSE_SCHEMA = {
  type: "object", required: ["panelModels"],
  properties: {
    panelModels: { type: "array", items: { enum: ["opus", "fable", "sonnet"] }, description: "1–5 models, one per architect; Opus by default, a Sonnet panelist for a lighter aspect, a Fable panelist only for high-complexity/high-impact work (a hard algorithm's core, deep bug-hunts, blast-radius analysis)" },
    aspects: { type: "array", items: { enum: ASPECTS }, description: "one aspect per panel member, in panelModels order, chosen for THIS task from the fixed vocabulary — pick the panel-size aspects that matter most, distinct, most-relevant first; omit for a single-member panel" },
    rationale: { type: "string", description: "one line on the composition chosen" },
  },
}
const PLAN_SCHEMA = {
  type: "object", required: ["steps"],
  properties: {
    recommendation: { type: "string", description: "the settled approach in one or two sentences, for the design summary" },
    rationale: { type: "string", description: "why this approach; what is deliberately out of scope" },
    risks: { type: "string", description: "main risks or open questions, or 'none'" },
    greenBar: { type: "string", description: "the concrete build/test/lint command(s), from the PROJECT'S OWN rules, that define a green tree — every wave must end green by this bar; leave empty and raise a QUESTION in `risks` if the project's green criteria are unclear" },
    blocker: { type: "string", description: "set ONLY to raise an ask-back: the rough plan is internally contradictory, under-specified, or its premise is wrong given the code. Put the verbatim BLOCKER/QUESTION text (what is contradictory/wrong and the choices you see) here and return an EMPTY `steps` array; leave unset when producing a plan. A schema-legal channel — prose in place of this crashes the workflow." },
    integrationDifficulty: { enum: ["low", "medium", "high"], description: "how hard THIS aspect's plan will be to reconcile with the other panellists' — conflicting structure, shared files, or contested sequencing raise it; used to pick the integrator tier" },
    integrationDifficultyReason: { type: "string", description: "one line explaining the integrationDifficulty rating" },
    steps: {
      type: "array",
      description: "steps grouped into ascending waves; a wave is a COMPLETE, GREEN, DELIVERABLE slice — a milestone leaving the tree green per the project's own rules; same-wave steps MAY be dependent and MAY share files, but every same-wave dependency MUST be declared in dependsOn; later waves build on earlier waves' integrated result.",
      items: {
        type: "object", required: ["title", "change", "complexity", "wave"],
        properties: {
          id: { type: "string", description: "short stable identifier the author assigns, unique across the plan (e.g. 'schema', 'dispatch'); other steps reference it in dependsOn" },
          title: { type: "string", description: "short imperative label" },
          files: { type: "array", items: { type: "string" }, description: "repo-relative files this step touches — the dispatcher uses them to route and order workers" },
          change: { type: "string", description: "the concrete change to make" },
          complexity: { enum: ["menial", "mechanical", "substantive"], description: TIERS_DESC },
          confidence: { enum: ["low", "medium", "high"], description: "how settled this step is — 'low' flags a shaky step (uncertain change, unresolved detail) so the integrator and coordinator can scrutinise it" },
          wave: { type: "integer", description: "1-based wave number. A wave is a self-contained GREEN milestone; same-wave steps MAY depend on each other, but every intra-wave dependency MUST be declared via dependsOn; the executor resolves dispatch (parallel, merged, or chained). Later waves build on earlier waves' integrated result." },
          dependsOn: { type: "array", items: { type: "string" }, description: "ids of steps this step builds on — same or EARLIER wave only, never later; same-wave dependencies are resolved downstream by the dispatch composer (merge into one worker or chain workers)" },
          role: { enum: ["deliverable", "verify"], description: "'verify' ONLY for a step whose sole job is verification/formatting/lint of THIS wave's own work; everything else is 'deliverable' (default when omitted). A wave of only 'verify' steps is not allowed — verify is a wave's CLOSING step, never a whole wave; a 'verify' step is a HINT that execute-wave relays to the wave's integrate-and-verify gate (performed against the integrated tree) instead of building it, so mislabelling a deliverable step 'verify' risks it being relayed rather than built." },
          verify: { type: "string", description: "how to confirm this step is correct" },
        },
      },
    },
  },
}

const roughBlock = ROUGH ? "\n\nRough plan drafted with the user (refine THIS — do not start over):\n" + ROUGH + "\n" : "\n\n(No rough plan supplied — derive the plan from the task.)\n"

const refinePrompt = aspect =>
  "## Refine into an implementation plan\nTask: " + TASK + roughBlock + "\n" +
  (aspect
    ? "You are one of several architects refining this plan IN PARALLEL, and you OWN one aspect of it: **" + aspect + "**. Work that aspect out thoroughly and correctly across the whole plan; leave the other aspects at a sound baseline — a separate integrator will merge your aspect's strengths with the others'. The whole rough plan above is your context. Also rate `integrationDifficulty` (low/medium/high) with a one-line `integrationDifficultyReason` — how hard your aspect's plan will be to reconcile with the other panellists' (conflicting structure, shared files, or contested sequencing raise it) — and tag each step's `confidence` (low/medium/high) so the integrator can scrutinise and down-weight the shaky ones.\n\n"
    : "\n") +
  GROUNDING + "\n\n" +
  "Turn the rough plan into a concrete plan of at most " + MAX_STEPS + " steps. For each step: name the file(s), describe the concrete change, state what to verify, tag its complexity (" + TIERS_DESC + "), and assign a 1-based WAVE number. Choose the complexity by weighing the judgement the step needs against the cost of getting it wrong.\n\n" +
  "A wave is a COMPLETE, GREEN, DELIVERABLE slice — a milestone that leaves the tree green per the project's own rules; same-wave steps MAY be dependent and MAY share files, and later waves build on earlier waves' integrated result. Give each step a short stable `id` and declare inter-step dependencies via `dependsOn` (the downstream composer turns them into parallel, merged, or chained dispatch); a dependency may only point at a same-wave or EARLIER step, never a later one. Include verify/format work only ever as a wave's CLOSING step covering that wave's own work — NEVER a wave whose steps are all verification/formatting; tag such a closing verification/formatting/lint step with `role: 'verify'` and leave every other step's role at the default 'deliverable'. Determine the project's green bar from its own rules and emit it as `greenBar`. Leave NO design judgement unresolved downstream — 'substantive' means judgement about implementation, not about the design, which is settled here. Also return recommendation/rationale/risks as a short design summary.\n\n" +
  "If the rough plan is internally contradictory or its premise is wrong given the code, STOP and return that as a BLOCKER instead of a plan. If the project's green criteria are not determinable, put a QUESTION (marked QUESTION:) in `risks` and leave greenBar empty rather than guessing.\n\n" + GUIDELINES_BLOCK + "\n\n" + COMMS

// ─── Compose: pick the architect composition (and/or the ordered aspects) ───
// Run the composer whenever there is a composition decision to make: to CHOOSE the
// models when the coordinator left them open, OR — even when the panel is fixed —
// to assign the ordered, task-relevant aspects across a multi-member panel.
let compositionRationale = ""
let composerAspects = null
const composeForAspects = panelSpecified && validModelList(panelModels) && panelModels.length > 1
const composePrompt = fixedPanel =>
  "## Choose the architect composition for this design\nTask: " + TASK + roughBlock + "\n" +
  (fixedPanel
    ? "The panel is FIXED at these " + fixedPanel.length + " models: [" + fixedPanel.join(", ") + "] — you are NOT choosing the models. Echo them back verbatim in `panelModels` (same order), and put your judgement into the ordered `aspects`: assign each panelist ONE aspect from the fixed vocabulary, in panelModels order, distinct, most task-relevant first.\n\n"
    : "Decide who should refine this plan. On a multi-member panel each architect OWNS one aspect (correctness, architecture, decomposition, verification, risk); a single member does the whole refinement. Return `panelModels` — 1–5 entries of 'opus'/'fable'/'sonnet', one architect each; a Sonnet panelist may be auto-assigned a lighter aspect, Opus is the default, a Fable panelist owns a hard aspect. On a multi-member panel you must ALSO return `aspects` — one per panelist, in panelModels order, from the fixed vocabulary, most task-relevant first.\n\n" +
      "Guidance: Opus is the default thinking tier and handles most designs well. Sonnet can own a lighter aspect on a multi-member panel. Fable is stronger but bills extra — reach for a Fable panelist only for HIGH-COMPLEXITY or HIGH-IMPACT work: the core of a hard algorithm, deep analysis of a large/existing codebase, hunting subtle long-standing bugs, or tracing the blast radius of a decision. A single ['opus'] suits a routine refinement; a 2–3 panel divides the plan into aspects. You do NOT choose the integrator — its tier is deferred until after the panel fans out, defaulting to Opus and escalating to Fable when the panel flags high integration difficulty.\n\n") +
  "You are CHOOSING the composition and the ordered aspect assignment — you do not design the plan itself.\n\n" + COMMS
if (!panelSpecified || composeForAspects) {
  phase("Compose")
  const picked = await safeAgent(
    composePrompt(composeForAspects ? panelModels : null),
    { label: "compose", phase: "Compose", model: "sonnet", schema: COMPOSE_SCHEMA }
  )
  if (!panelSpecified) {
    if (picked && validModelList(picked.panelModels)) panelModels = picked.panelModels
    if (picked && picked.rationale) compositionRationale = picked.rationale
  }
  if (picked && Array.isArray(picked.aspects)) composerAspects = picked.aspects
}
// Static fallback (composer omitted or failed): spend Fable sparingly.
if (!validModelList(panelModels)) panelModels = LEVEL === "deep" ? ["fable", "opus", "fable"] : ["opus"]
// The integrator tier is deferred until after the panel fans out (resolved from the
// panel's own integrationDifficulty signal), so log it here only when the coordinator
// pinned it — otherwise it is chosen post-fan-out.
log("Composition: panel=[" + panelModels.join(",") + "] integrator=" + (integSpecified ? integratorModel : "post-fan-out") + (compositionRationale ? " — " + compositionRationale : ""))

// ─── Refine ───
// A multi-member panel divides the labour: each architect OWNS one aspect of the
// plan (with the whole rough plan for context), rather than every member redundantly
// re-refining the entire thing. A single member does the full refinement.
phase("Refine")
// Map the composer's chosen aspects onto the panel: keep the valid, distinct picks
// in order, then backfill any shortfall from the fixed vocabulary so every panelist
// owns a distinct aspect. A single member owns none (whole-plan refinement).
const assignAspects = (n, chosen) => { if (n <= 1) return [null]; const out = [], seen = new Set(); (Array.isArray(chosen) ? chosen : []).forEach(a => { if (ASPECTS.includes(a) && !seen.has(a)) { seen.add(a); out.push(a) } }); ASPECTS.forEach(a => { if (!seen.has(a)) { seen.add(a); out.push(a) } }); return out.slice(0, n) }
const multi = panelModels.length > 1
const aspectsUsed = assignAspects(panelModels.length, multi ? composerAspects : null)
if (multi) log("Aspects: " + aspectsUsed.join(" | "))
const raw = await parallel(
  panelModels.map((m, i) => async () => {
    try {
      return await agent(refinePrompt(aspectsUsed[i]), { label: "refine:" + (i + 1), phase: "Refine", model: m, effort: "high", agentType: NS + "architect", schema: PLAN_SCHEMA })
    } catch (e) {
      log("refine:" + (i + 1) + " CRASHED: " + (e && e.message ? e.message : e))
      return null
    }
  })
)
const candidates = []
raw.forEach((r, i) => { if (r) { r._aspect = aspectsUsed[i]; candidates.push(r) } })
log("Panel: " + candidates.length + " aspect-refined plan(s) [" + panelModels.join(",") + "]")
if (candidates.length === 0) return { error: "Refinement produced no candidate plan." }
const blocked = candidates.find(c => typeof c.blocker === "string" && c.blocker.trim())
if (blocked) return { error: "design-panel BLOCKER: " + blocked.blocker.trim(), design: { recommendation: blocked.recommendation || "", rationale: blocked.rationale || "", risks: blocked.risks || "" }, plan: [] }

// Resolve the deferred integrator tier from the panel's own difficulty signal: Opus
// by default, escalating to Fable when any candidate flags integration as high. A
// coordinator-specified integrator is left untouched.
if (!integSpecified) integratorModel = candidates.some(c => c.integrationDifficulty === "high") ? "fable" : "opus"
log("Integrator: " + integratorModel + (integSpecified ? " (specified)" : " (resolved post-fan-out)"))

// ─── Integrate: merge the aspect-refined plans into one coherent plan ───
// A single candidate IS the finished plan — nothing to merge, so return it directly
// (no integrator), even if an integratorModel was named. Integrating one plan is a wasted call.
let refined
let stuckReason = ""
if (candidates.length > 1) {
  phase("Integrate")
  const block = candidates.map((c, i) =>
    "### Plan [" + i + "]" + (c._aspect ? " — aspect owned: " + c._aspect : "") + (c.integrationDifficulty ? " [integration difficulty: " + c.integrationDifficulty + "]" : "") + "\nRecommendation: " + (c.recommendation || "") + "\nGreenBar: " + (c.greenBar || "") + "\nRisks: " + (c.risks || "") + "\nSteps:\n" +
    (Array.isArray(c.steps) ? c.steps : []).map((s, k) => "  " + (k + 1) + ". (wave " + s.wave + ", " + s.complexity + (s.confidence ? ", confidence " + s.confidence : "") + ")" + (s.id ? " id=" + s.id : "") + (Array.isArray(s.dependsOn) && s.dependsOn.length ? " deps=[" + s.dependsOn.join(",") + "]" : "") + " " + s.title + " — " + s.change + (s.files && s.files.length ? " [" + s.files.join(", ") + "]" : "")).join("\n")
  ).join("\n\n")
  const aspectsLine = candidates.map(c => c._aspect).filter(Boolean).join("; ")
  const integratorPrompt =
    "## Integrate the aspect-refined plans into ONE\nTask: " + TASK + roughBlock + "\n" +
    "You have " + candidates.length + " plan(s)" + (aspectsLine ? ", each refined by a specialist who OWNED one aspect (" + aspectsLine + ")" : "") + ". The panel has ALREADY deliberated and grounded their plans in the repo — TRUST that work. ADOPT each specialist's contribution on the aspect they owned as authoritative (the correctness specialist's edge-case steps, the architecture specialist's structure/reuse, the decomposition specialist's waving, the verification specialist's checks, and so on). Where members merely cover different ground, UNION their steps. MEDIATE only where two members GENUINELY conflict — they contradict each other, or one member's step would break another's — and when you mediate, prefer the aspect-owner's intent for the disputed aspect. Do NOT re-derive, re-plan, or 'improve' a member's aspect where there is no conflict — that discards the deliberation you are here to preserve. Keep it to at most " + MAX_STEPS + " steps, correctly waved (each wave a self-contained green deliverable; same-wave dependencies declared via id/dependsOn; no verify/format-only wave), each step tagged with complexity (" + TIERS_DESC + "). PRESERVE each step's id, dependsOn edges and role, tagging a closing verification/formatting/lint step with `role: 'verify'` and leaving every other step at the default 'deliverable', and emit one reconciled greenBar.\n\nEach candidate step carries a `confidence` (low/medium/high). SCRUTINISE and down-weight low-confidence steps when reconciling, and CARRY the confidence through onto each step you emit so the coordinator can see which steps remain shaky. If two grounded plans GENUINELY contradict and you cannot reconcile them, set `blocker` with the verbatim conflict rather than guessing.\n\nThe panel already explored the repository, so you do NOT need to re-explore: read code ONLY to settle a specific conflict a candidate's citation cannot resolve. Cite path:line for load-bearing claims, follow repo conventions (including British spelling in identifiers/output where the repo uses it), and apply YAGNI — no speculative scope." + "\n\n" + block + "\n\n" + GUIDELINES_BLOCK + "\n\n" + COMMS
  // Escalation ladder: start at the resolved integrator tier and climb only when the
  // integrator raises a reconciliation blocker (never on a null crash, which falls
  // through to the existing null handling below). A persistent blocker at the top tier
  // surfaces to the coordinator via the blocker→{error} return.
  const LADDER = ["sonnet", "opus", "fable"]
  let startIdx = Math.max(0, LADDER.indexOf(integratorModel))
  for (let k = startIdx; k < LADDER.length; k++) {
    const escalationNote = stuckReason
      ? "\n\n## Escalation\nA prior, lower-tier integrator could NOT reconcile these plans and raised:\n" + stuckReason + "\nYou are the ESCALATED, more-capable integrator — genuinely attempt the reconciliation the prior tier could not, and produce the merged plan. If, and ONLY if, the obstacle is a real premise problem or an open user question that no tier can resolve, set `blocker` again with the verbatim ask — surface the genuine ask-back, never guess.\n"
      : ""
    refined = await safeAgent(
      integratorPrompt + escalationNote,
      { label: "integrate:" + LADDER[k], phase: "Integrate", model: LADDER[k], effort: "max", agentType: NS + "architect", schema: PLAN_SCHEMA }
    )
    if (!refined) break
    if (typeof refined.blocker === "string" && refined.blocker.trim() && k < LADDER.length - 1) {
      stuckReason = refined.blocker.trim()
      log("integrate: " + LADDER[k] + " could not reconcile — escalating to " + LADDER[k + 1] + ": " + stuckReason)
      continue
    }
    break
  }
} else {
  refined = candidates[0]
}

// agentCrash is fresh here: refined is null ONLY on the integrator path (the single-candidate branch sets refined = candidates[0], always truthy), whose safeAgent reset agentCrash for its own call.
if (!refined) return { error: "design-panel: refinement crashed — " + (agentCrash || "the integrator produced no valid StructuredOutput") + (stuckReason && stuckReason.trim() ? " | prior integrator blocker: " + stuckReason.trim() : "") + ". No plan produced; worktrees/commits (if any) left for manual recovery.", design: null, plan: [] }
if (typeof refined.blocker === "string" && refined.blocker.trim()) return { error: "design-panel BLOCKER: " + refined.blocker.trim(), design: { recommendation: refined.recommendation || "", rationale: refined.rationale || "", risks: refined.risks || "" }, plan: [] }
if (!Array.isArray(refined.steps) || refined.steps.length === 0) return { error: "Refinement failed to produce steps.", design: { recommendation: refined.recommendation, rationale: refined.rationale, risks: refined.risks }, plan: [] }

// Attach a stable 1-based index; normalise wave number and complexity (three tiers).
const TIERS = ["menial", "mechanical", "substantive"]
const rawSteps = refined.steps.slice(0, MAX_STEPS)
const steps = rawSteps.map((s, i) => ({
  idx: i,
  title: s.title,
  files: Array.isArray(s.files) ? s.files : [],
  change: s.change,
  complexity: TIERS.includes(s.complexity) ? s.complexity : "mechanical",
  confidence: ["low", "medium", "high"].includes(s.confidence) ? s.confidence : undefined,
  wave: Number.isInteger(s.wave) && s.wave > 0 ? s.wave : 1,
  role: s.role === "verify" ? "verify" : "deliverable",
  verify: s.verify || "",
  dependsOn: [],
}))

// ─── Normalise inter-step dependencies (author ids → idx edges) ───
// Authors label steps with a stable `id` and point `dependsOn` at those ids; we
// resolve them to index edges, drop anything invalid, and break same-wave cycles
// so the dispatch composer downstream gets a clean DAG. `id` is author-facing
// only — it never leaves this function. Every dropped edge is logged and, if any,
// summarised into the design risks.
const droppedEdges = []
const idCollisions = []

// Pass 1: resolve each step's effective id (falling back to a positional id), and
// build id→idx keeping the FIRST claimant of a duplicate so refs stay deterministic.
const idToIdx = new Map()
const effIds = rawSteps.map((s, i) => (typeof s.id === "string" && s.id.trim()) ? s.id.trim() : "step-" + (i + 1))
effIds.forEach((id, i) => {
  if (idToIdx.has(id)) {
    idCollisions.push(id + " (kept step " + (idToIdx.get(id) + 1) + ", dropped step " + (i + 1) + ")")
    log("normalise: duplicate step id '" + id + "' — keeping step " + (idToIdx.get(id) + 1) + ", ignoring step " + (i + 1))
  }
  else idToIdx.set(id, i)
})

// Pass 2: turn each author dependsOn (a list of ids) into a deduped idx array,
// dropping unknown ids, self-references, and any edge onto a LATER wave (which
// contradicts wave ordering — deps may only point same-wave or earlier).
steps.forEach((step, i) => {
  const authored = Array.isArray(rawSteps[i].dependsOn) ? rawSteps[i].dependsOn : []
  const seen = new Set()
  authored.forEach(dep => {
    const id = typeof dep === "string" ? dep.trim() : ""
    const j = idToIdx.has(id) ? idToIdx.get(id) : -1
    if (j < 0) { droppedEdges.push(effIds[i] + "→" + (id || String(dep)) + " (unknown)"); log("normalise: step " + (i + 1) + " drops unknown dependency '" + dep + "'"); return }
    if (j === i) { droppedEdges.push(effIds[i] + "→" + effIds[j] + " (self)"); log("normalise: step " + (i + 1) + " drops self-dependency"); return }
    if (steps[j].wave > step.wave) { droppedEdges.push(effIds[i] + "→" + effIds[j] + " (later wave)"); log("normalise: step " + (i + 1) + " drops dependency on later-wave step " + (j + 1)); return }
    if (!seen.has(j)) { seen.add(j); step.dependsOn.push(j) }
  })
})

// Pass 3: break same-wave cycles (cross-wave cycles are impossible after pass 2,
// since every surviving edge points same-wave or earlier). Add edges one at a
// time in listed order, skipping any whose target can already reach the source.
const adj = steps.map(() => [])
const reaches = (from, to) => {
  const stack = [from], seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (n === to) return true
    if (seen.has(n)) continue
    seen.add(n)
    for (const m of adj[n]) stack.push(m)
  }
  return false
}
steps.forEach((step, i) => {
  const kept = []
  step.dependsOn.forEach(j => {
    if (reaches(j, i)) { droppedEdges.push(effIds[i] + "→" + effIds[j] + " (cycle)"); log("normalise: step " + (i + 1) + " drops dependency on step " + (j + 1) + " to break a same-wave cycle") }
    else { adj[i].push(j); kept.push(j) }
  })
  step.dependsOn = kept
})

if (idCollisions.length) {
  const note = "plan normalisation resolved " + idCollisions.length + " id collision(s) by first-occurrence: " + idCollisions.join(", ") + "."
  refined.risks = refined.risks ? refined.risks + " " + note : note
}

if (droppedEdges.length) {
  const note = "plan normalisation dropped " + droppedEdges.length + " invalid dependency edge(s): " + droppedEdges.join(", ") + "."
  refined.risks = refined.risks ? refined.risks + " " + note : note
}

// ─── Enforce wave invariants ───
// A wave must deliver real work: a wave made up entirely of verify/format-only steps
// is not a milestone, so fold it into a neighbouring deliverable wave (the nearest
// EARLIER one, else the nearest later). `role` is read off the raw step here (defaulting
// to 'deliverable' when omitted) for the fold; it is ALSO emitted on the returned step
// above and acted on downstream — execute-wave relays a 'verify' step to the wave's
// integrate-and-verify gate instead of building it.
const roleOf = i => (rawSteps[i] && rawSteps[i].role === "verify") ? "verify" : "deliverable"
const wavesInPlan = [...new Set(steps.map(s => s.wave))].sort((a, b) => a - b)
const deliverableWaves = new Set(wavesInPlan.filter(w => steps.some(s => s.wave === w && roleOf(s.idx) === 'deliverable')))
if (deliverableWaves.size === 0) {
  return { error: "design-panel: every wave is verify/format-only — the plan contains no deliverable work." }
}
const folds = []
wavesInPlan.forEach(w => {
  if (deliverableWaves.has(w)) return
  const earlier = [...deliverableWaves].filter(x => x < w)
  const target = earlier.length ? Math.max(...earlier) : Math.min(...[...deliverableWaves].filter(x => x > w))
  steps.forEach(s => { if (s.wave === w) s.wave = target })
  folds.push("wave " + w + "→" + target)
  log("enforce: folded verify/format-only wave " + w + " into deliverable wave " + target)
})
if (folds.length) {
  const note = "plan normalisation folded " + folds.length + " verify/format-only wave(s) into a deliverable wave: " + folds.join(", ") + "."
  refined.risks = refined.risks ? refined.risks + " " + note : note
}

// A wave must close green, so an empty greenBar is a design gap — surface it as a
// QUESTION unless the panel already raised one in the risks.
const greenBar = typeof refined.greenBar === "string" ? refined.greenBar.trim() : ""
if (!greenBar && !(refined.risks || "").includes("QUESTION")) {
  const note = "QUESTION: greenBar is empty — the project's green criteria were not determinable; confirm the build/test/lint command(s) that define a green tree."
  refined.risks = refined.risks ? refined.risks + " " + note : note
}

const waveNums = [...new Set(steps.map(s => s.wave))].sort((a, b) => a - b)
log("Plan: " + steps.length + " steps across " + waveNums.length + " wave(s)")

return {
  level: LEVEL,
  task: TASK,
  design: { recommendation: refined.recommendation || "", rationale: refined.rationale || "", risks: refined.risks || "" },
  plan: steps,
  waves: waveNums,
  greenBar: greenBar,
}
