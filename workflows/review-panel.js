export const meta = {
  name: "review-panel",
  description: "Deep final review of a completed change: a fan-out of reviewers (each on a distinct lens) closed by an integrator that merges them into ONE verdict (most severe wins). By default a cheap Sonnet composer picks the composition — Sonnet is admissible on lighter lenses; the coordinator overrides via reviewModels — a single Sonnet/Opus/Fable reviewer, a mixed panel, or the two-tier pattern (a panel then a separate final verdict) — only when the user asks for a specific one. The integrator tier is deferred: it defaults to Opus and escalates to Fable when the panel reports high integration difficulty, then climbs the tier ladder if it gets stuck. Mirrors design-panel; called for the whole-change gate after per-wave verification.",
  whenToUse: "Invoked by the tiered-development skill for a deep final review. Pass args as an object: { level, task, design, changed, files?, guidelines?, reviewModels?, integratorModel? } — reviewModels is a 1–5 array of 'opus'/'fable'/'sonnet'; integratorModel ('opus'|'fable'|'sonnet') merges the panel into the final verdict, defaulting to Opus (escalating to Fable on high integration difficulty) when omitted. Omit them to let a Sonnet composer choose. Returns { level, review: { verdict, evidence, problems, blocker }, candidates }.",
  phases: [
    { title: "Compose", detail: "Only when the composition is unspecified: a Sonnet composer picks the reviewer models", model: "sonnet" },
    { title: "Review", detail: "Reviewer(s) (Sonnet, Opus and/or Fable), each on a distinct lens, review the change against its intent" },
    { title: "Integrate", detail: "When >1 candidate: a reviewer merges the verdicts into one (most severe wins), escalating up the tier ladder if it gets stuck" },
  ],
}

// ─── Args ───
let A = args
if (typeof A === "string") { try { A = JSON.parse(A) } catch { A = {} } }
if (!A || typeof A !== "object") A = {}
const LEVEL = ["quick", "standard", "deep"].includes(A.level) ? A.level : "standard"
const TASK = typeof A.task === "string" ? A.task.trim() : ""
const DESIGN = typeof A.design === "string" ? A.design.trim() : ""
const CHANGED = typeof A.changed === "string" ? A.changed.trim() : ""
// Standing, project-wide rules the coordinator forwards verbatim from the project's guidelines file
// (`GUIDELINES.md`) so it never has to restate them per task. Injected into
// every agent that designs, writes, or judges code — never summarised, since they are requirements.
const GUIDELINES = typeof A.guidelines === "string" ? A.guidelines.trim() : ""
const FILES = Array.isArray(A.files) ? A.files : []
if (!TASK) return { error: "No task given. Pass args as { level, task, design, changed }." }

// Reviewer/integrator models: Sonnet is now admissible (cheap, for lighter lenses),
// alongside Opus and Fable. Fable is the premium tier — spend it sparingly. Scream on a bad value.
const MODEL_SET = ["opus", "fable", "sonnet"]
const validModelList = a => Array.isArray(a) && a.length >= 1 && a.length <= 5 && a.every(m => MODEL_SET.includes(m))
let reviewModels = A.reviewModels
let integratorModel = A.integratorModel
const panelSpecified = reviewModels !== undefined && reviewModels !== null
const integSpecified = integratorModel !== undefined && integratorModel !== null && integratorModel !== ""
if (panelSpecified && !validModelList(reviewModels)) {
  return { error: "review-panel: `reviewModels` must be a non-empty array (≤5) of 'opus'/'fable'/'sonnet', got " + JSON.stringify(A.reviewModels) + "." }
}
if (integSpecified && !MODEL_SET.includes(integratorModel)) {
  return { error: "review-panel: `integratorModel` (the final-verdict integrator) must be 'opus', 'fable' or 'sonnet', got " + JSON.stringify(A.integratorModel) + "." }
}

// Agent types are namespaced; agentType must carry the prefix.
const NS = "tiered-development:"

// ─── Resilient agent call ───
// A schema-carrying agent() THROWS when the worker never produces valid StructuredOutput
// ('StructuredOutput retry cap (5) exceeded'). That must degrade to a review-level failure in
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
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Return only the structured output — no preamble, no restating this prompt. Cut filler/hedging/praise. path:line on every code claim; quote the shortest decisive line of any command output. Keep verbatim: error strings, commands, identifiers, the verdict keywords (pass/needs-changes/fail/blocked), and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
const GUIDELINES_BLOCK = GUIDELINES
  ? "\n\n## Project guidelines — standing rules for this repository\n" +
    "These come from the project's committed GUIDELINES.md and apply to EVERY task here, not only this one. They are HARD REQUIREMENTS: follow them as written, and do not ask the coordinator to repeat them.\n" +
    "You may NOT decide to break one. If your instructions above cannot be carried out without violating a guideline, that is a BLOCKER, not a judgement call: STOP, do NOT implement a violating version, and report it through your ask-back channel — name the guideline, state exactly what conflicts with it, why you can see no compliant way to do the task, and what you would do if authorised. Only the USER authorises a violation, via the coordinator. A violation is a last resort someone else signs off, never a call you make and mention afterwards.\n\n" +
    GUIDELINES + "\n\n— end of project guidelines —\n"
  : ""
const LENSES = ["subtle correctness & logic", "architectural coherence & cross-module interactions", "security, error paths, resource handling & partial failure", "tests & coverage", "scope, simplicity & YAGNI"]
const contextBlock =
  "Task: " + TASK + "\n\n" +
  (DESIGN ? "Approved design:\n" + DESIGN + "\n\n" : "") +
  (CHANGED ? "What changed:\n" + CHANGED + "\n\n" : "") +
  (FILES.length ? "Files touched: " + FILES.join(", ") + "\n\n" : "")

// ─── Schemas ───
const REVIEW_SCHEMA = {
  type: "object", required: ["verdict", "evidence"],
  properties: {
    verdict: { enum: ["pass", "needs-changes", "fail", "blocked"] },
    evidence: { type: "string", description: "what you ran or read and what it showed (path:line, command output)" },
    problems: {
      type: "array",
      description: "concrete problems, most important first; empty when there are none",
      items: {
        type: "object", required: ["point"],
        properties: {
          point: { type: "string", description: "the concrete problem, with path:line" },
          confidence: { enum: ["low", "medium", "high"], description: "how sure you are this is a real problem (optional)" },
        },
      },
    },
    blocker: { type: "string", description: "set ONLY for a 'blocked' verdict: the verbatim QUESTION/BLOCKER text — what was checked and exactly what could not be determined, and the choices you see. A schema-legal ask-back channel; leave unset for any other verdict." },
    integrationDifficulty: { enum: ["low", "medium", "high"], description: "how hard this review is likely to be to merge with the other lenses' verdicts (optional)" },
    integrationDifficultyReason: { type: "string", description: "one line on why the integration difficulty is what it is (optional)" },
  },
}
const COMPOSE_SCHEMA = {
  type: "object", required: ["reviewModels"],
  properties: {
    reviewModels: { type: "array", items: { enum: ["opus", "fable", "sonnet"] }, description: "1–5 models, one per reviewer; Opus by default, Sonnet for a lighter lens on a routine change, a Fable reviewer only for high-complexity/high-impact changes (deep bug-hunts in existing code, blast-radius analysis of a decision)" },
    rationale: { type: "string", description: "one line on the composition chosen" },
  },
}

const reviewPrompt = lens =>
  "## Review this completed change against its intent\n" + contextBlock +
  (lens ? "Focus your review through this lens: **" + lens + "** (but flag anything serious you notice outside it).\n\n" : "") +
  "Review against the STATED intent, not just what the diff happens to do. A change that builds and passes per-step checks but does the wrong thing, or the right thing in a way that breaks something else, is a failure. Prefer evidence — run the relevant tests/build/lint if the repo supports it and quoting the output is cheap; never suppress output through tail/head/grep. Cite path:line for every concrete claim.\n\n" +
  "Return: VERDICT (pass/needs-changes/fail/blocked — use blocked ONLY when you genuinely cannot determine the verdict: unclear intent or genuinely inconclusive evidence; put your QUESTION/BLOCKER text verbatim in `blocker`, NOT in problems), the evidence, and each concrete problem as an entry in the problems array (most important first; a `point` per problem, empty array when there are none)." +
  (lens ? " You are one of several reviewers whose verdicts an integrator will merge, so ALSO give each problem a `confidence` (low/medium/high) and set `integrationDifficulty` (low/medium/high) with a one-line `integrationDifficultyReason` — how hard your findings will be to reconcile with the other lenses'." : "") +
  " Your final output is the mandatory StructuredOutput call — never answer in prose in its place.\n\n" + GUIDELINES_BLOCK + "\n\n" + COMMS

// ─── Compose: pick the reviewer composition when the coordinator did not ───
let compositionRationale = ""
if (!panelSpecified) {
  phase("Compose")
  // safeAgent (not agent): a composer crash degrades to null — no early return needed, the
  // null-guards below + the static fallback already recover a null composer (unlike execute-wave).
  const picked = await safeAgent(
    "## Choose the reviewer composition for this final review\n" + contextBlock +
    "Decide who should review this change. Return `reviewModels` — 1–5 entries of 'opus'/'fable'/'sonnet', one reviewer each.\n\n" +
    "Guidance: Opus is the default and reviews most changes well. Sonnet is cheap and can be auto-assigned to a lighter lens on a routine change. Fable is stronger but bills extra — reach for a Fable reviewer only for HIGH-COMPLEXITY or HIGH-IMPACT changes: deep analysis of a large/existing codebase, hunting subtle long-standing bugs, or tracing the blast radius of a decision. A single ['opus'] suits a routine change; a 2–3 panel puts each reviewer on a different lens. You do NOT choose the integrator — its tier is resolved after the panel reports, defaulting to Opus and escalating to Fable when a reviewer flags high integration difficulty.\n\n" +
    "You are only CHOOSING reviewer models — you do not review anything.\n\n" + COMMS,
    { label: "compose", phase: "Compose", model: "sonnet", schema: COMPOSE_SCHEMA }
  )
  if (picked && validModelList(picked.reviewModels)) reviewModels = picked.reviewModels
  if (picked && picked.rationale) compositionRationale = picked.rationale
}
// Static fallback (composer omitted or failed): spend Fable sparingly.
if (!validModelList(reviewModels)) reviewModels = LEVEL === "deep" ? ["fable", "opus", "fable"] : ["opus"]
// The integrator tier is DEFERRED: unless the coordinator fixed it, it is resolved
// after the fan-out from the panel's reported integration difficulty (see below).
log("Composition: panel=[" + reviewModels.join(",") + "] integrator=" + (integSpecified ? integratorModel : "post-fan-out") + (compositionRationale ? " — " + compositionRationale : ""))

// ─── Review ───
phase("Review")
const multi = reviewModels.length > 1
const lensesUsed = reviewModels.map((m, i) => multi ? LENSES[i % LENSES.length] : null)
// Fan-out uses a per-thunk try/catch (NOT safeAgent — agentCrash is shared module state,
// unsafe under parallel()); the `if (r)` filter below drops a crashed reviewer, and
// `candidates.length === 0` fails only if ALL reviewers crash.
const raw = await parallel(
  reviewModels.map((m, i) => async () => {
    try { return await agent(reviewPrompt(lensesUsed[i]), { label: "review:" + (i + 1), phase: "Review", model: m, effort: "high", agentType: NS + "deep-reviewer", schema: REVIEW_SCHEMA }) }
    catch (e) { log("review:" + (i + 1) + " CRASHED: " + (e && e.message ? String(e.message) : String(e))); return null }
  })
)
const candidates = []
raw.forEach((r, i) => { if (r) { r._lens = lensesUsed[i]; candidates.push(r) } })
log("Panel: " + candidates.length + " review(s) [" + reviewModels.join(",") + "]")
if (candidates.length === 0) return { error: "Review produced no verdict." }

// Resolve the deferred integrator tier from the panel's reported integration difficulty:
// default Opus, escalate to Fable when any reviewer flagged the merge as high difficulty.
// A coordinator-fixed integratorModel is honoured as-is.
if (!integSpecified) integratorModel = candidates.some(c => c.integrationDifficulty === "high") ? "fable" : "opus"

// ─── Integrate: merge verdicts into one (most severe wins) ───
// A single verdict needs no merge — return it directly (no integrator), even if an
// integratorModel was named. Integrating one review is a wasted call.
let review
let stuckReason = ""
if (candidates.length > 1) {
  phase("Integrate")
  log("Integrator: " + integratorModel + (integSpecified ? "" : " (resolved from integration difficulty)"))
  const renderProblems = c => Array.isArray(c.problems) && c.problems.length
    ? c.problems.map(p => "  - " + (p && p.point ? p.point : "") + (p && p.confidence ? " [confidence: " + p.confidence + "]" : "")).join("\n")
    : "  none"
  const block = candidates.map((c, i) =>
    "### Reviewer [" + i + "] (" + (c._lens || "whole-change") + ")\nVerdict: " + c.verdict + "\nEvidence: " + (c.evidence || "") + "\nProblems:\n" + renderProblems(c) + (c.blocker && c.blocker.trim() ? "\nBlocker (QUESTION): " + c.blocker.trim() : "")
  ).join("\n\n")
  // Escalation ladder: start at the resolved integrator tier and climb only when the
  // integrator returns a genuine 'blocked' ask-back (non-empty blocker), feeding the
  // prior stuck reason forward. A crash (safeAgent -> null) breaks out to the {error}
  // path below — NEVER escalated, and never a fabricated verdict.
  const LADDER = ["sonnet", "opus", "fable"]
  const startIdx = Math.max(0, LADDER.indexOf(integratorModel))
  stuckReason = ""
  const prompt =
    "## Integrate the panel into ONE final verdict\n" + contextBlock +
    "You have " + candidates.length + " independent review(s) of this change. The panel has ALREADY reviewed it — TRUST their findings and do NOT re-review the change from scratch. Merge them into ONE verdict: the overall verdict is the MOST SEVERE present — `fail` beats `needs-changes` beats `pass`. Consolidate and de-duplicate the problems into the problems array (each an entry with a `point`, most important first), carrying each source problem's `confidence` through; SCRUTINISE and DOWN-WEIGHT low-confidence items — verify a low-confidence claim yourself if cheap before keeping it, and drop the ones that do not hold up. Adjudicate ONLY where reviewers DISAGREE — one makes a claim another refutes; drop any claim a later reviewer convincingly refuted. When adjudicating such a DISPUTED claim you may verify that specific claim yourself if it is cheap — this is not a licence for blanket re-verification.\n\n" +
    "A reviewer 'blocked' means it genuinely COULD NOT determine the verdict — its QUESTION is in that reviewer's `blocker`; RESOLVE it yourself from the candidates/cheap verification under the adjudication licence above where you can, and give the merged verdict 'blocked' ONLY when it stays genuinely unresolved, carrying the open QUESTION verbatim in `blocker` (NOT in problems) plus any fail/needs-changes findings in the problems array. 'blocked' (cannot determine) is DISTINCT from 'fail' (a definite defect) — never collapse one into the other. If YOU cannot merge into a determinate verdict, return 'blocked' with your QUESTION in `blocker`, through the mandatory StructuredOutput — never answer in prose.\n\n" + block + "\n\n" +
    "Return the final VERDICT, the merged evidence, and the consolidated problems array (empty when there are none).\n\n" + GUIDELINES_BLOCK + "\n\n" + COMMS
  for (let k = startIdx; k < LADDER.length; k++) {
    const note = stuckReason ? "\n\nA lower-tier integrator (" + LADDER[k - 1] + ") could not resolve this and escalated to you with:\n" + stuckReason + "\nResolve it if you can; escalate again only if it stays genuinely unresolvable.\n" : ""
    review = await safeAgent(
      prompt + note,
      { label: "integrate:" + LADDER[k], phase: "Integrate", model: LADDER[k], effort: "max", agentType: NS + "deep-reviewer", schema: REVIEW_SCHEMA }
    )
    if (!review) break
    const stuck = review.verdict === "blocked" && typeof review.blocker === "string" && review.blocker.trim()
    if (stuck && k < LADDER.length - 1) {
      stuckReason = review.blocker.trim()
      log("integrate: " + LADDER[k] + " blocked — escalating to " + LADDER[k + 1] + ": " + stuckReason)
      continue
    }
    break
  }
} else {
  review = candidates[0]
}

if (!review || !review.verdict) {
  return { error: "Review failed to produce a verdict." + (agentCrash ? " (integrator crashed: " + agentCrash + ")" : "") + (stuckReason ? " | prior integrator blocker: " + stuckReason : ""), candidates: candidates.map(({ _lens, ...rest }) => rest) }
}
log("Review verdict: " + review.verdict)

return {
  level: LEVEL,
  review: { verdict: review.verdict, evidence: review.evidence || "", problems: Array.isArray(review.problems) ? review.problems : [], blocker: (review.blocker && review.blocker.trim()) ? review.blocker : (review.verdict === "blocked" ? "(integrator returned a blocked verdict without explicit blocker text — see evidence)" : (review.blocker || "")) },
  candidates: candidates.map(({ _lens, ...rest }) => rest),
}
