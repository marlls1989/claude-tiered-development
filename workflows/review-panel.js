export const meta = {
  name: "review-panel",
  description: "Deep final review of a completed change: a fan-out of reviewers (each on a distinct lens) closed by a ≥Opus integrator that merges them into ONE verdict (most severe wins). By default a cheap Sonnet composer picks the composition; the coordinator overrides via reviewModels — a single Opus/Fable reviewer, an all-Opus/all-Fable/mixed panel, or the two-tier pattern (an Opus panel then a Fable final verdict) — only when the user asks for a specific one. Mirrors design-panel; called for the whole-change gate after per-wave verification.",
  whenToUse: "Invoked by the tiered-development skill for a deep final review. Pass args as an object: { level, task, design, changed, files?, reviewModels?, integratorModel? } — reviewModels is a 1–5 array of 'opus'/'fable'; integratorModel ('opus'|'fable', never Sonnet) merges the panel into the final verdict. Omit them to let a Sonnet composer choose. Returns { level, review: { verdict, evidence, problems }, candidates }.",
  phases: [
    { title: "Compose", detail: "Only when the composition is unspecified: a Sonnet composer picks the reviewer models + integrator", model: "sonnet" },
    { title: "Review", detail: "Reviewer(s) (Opus and/or Fable), each on a distinct lens, review the change against its intent" },
    { title: "Integrate", detail: "When >1 candidate (or an integrator is set): a ≥Opus reviewer merges the verdicts into one (most severe wins)" },
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
const FILES = Array.isArray(A.files) ? A.files : []
if (!TASK) return { error: "No task given. Pass args as { level, task, design, changed }." }

// Reviewer/integrator models are the thinking tiers: Opus or Fable ONLY (never
// Sonnet). Fable is the premium tier — spend it sparingly. Scream on a bad value.
const MODEL_SET = ["opus", "fable"]
const validModelList = a => Array.isArray(a) && a.length >= 1 && a.length <= 5 && a.every(m => MODEL_SET.includes(m))
let reviewModels = A.reviewModels
let integratorModel = A.integratorModel
const panelSpecified = reviewModels !== undefined && reviewModels !== null
const integSpecified = integratorModel !== undefined && integratorModel !== null && integratorModel !== ""
if (panelSpecified && !validModelList(reviewModels)) {
  return { error: "review-panel: `reviewModels` must be a non-empty array (≤5) of 'opus'/'fable', got " + JSON.stringify(A.reviewModels) + "." }
}
if (integSpecified && !MODEL_SET.includes(integratorModel)) {
  return { error: "review-panel: `integratorModel` (the final-verdict integrator) must be 'opus' or 'fable' — never Sonnet — got " + JSON.stringify(A.integratorModel) + "." }
}

// Agent types are namespaced; agentType must carry the prefix.
const NS = "tiered-development:"

// ─── Shared prompt fragments ───
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Return only the structured output — no preamble, no restating this prompt. Cut filler/hedging/praise. path:line on every code claim; quote the shortest decisive line of any command output. Keep verbatim: error strings, commands, identifiers, the verdict keywords (pass/needs-changes/fail), and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
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
    verdict: { enum: ["pass", "needs-changes", "fail"] },
    evidence: { type: "string", description: "what you ran or read and what it showed (path:line, command output)" },
    problems: { type: "string", description: "concrete problems, most important first, or 'none'" },
  },
}
const COMPOSE_SCHEMA = {
  type: "object", required: ["reviewModels"],
  properties: {
    reviewModels: { type: "array", items: { enum: ["opus", "fable"] }, description: "1–5 models, one per reviewer; Opus by default, a Fable reviewer only for high-complexity/high-impact changes (deep bug-hunts in existing code, blast-radius analysis of a decision)" },
    integratorModel: { enum: ["opus", "fable"], description: "model for the final-verdict integrator — ≥Opus, never Sonnet; defaults to the top tier in the panel, so make it 'fable' whenever a reviewer is Fable" },
    rationale: { type: "string", description: "one line on the composition chosen" },
  },
}

const reviewPrompt = lens =>
  "## Review this completed change against its intent\n" + contextBlock +
  (lens ? "Focus your review through this lens: **" + lens + "** (but flag anything serious you notice outside it).\n\n" : "") +
  "Review against the STATED intent, not just what the diff happens to do. A change that builds and passes per-step checks but does the wrong thing, or the right thing in a way that breaks something else, is a failure. Prefer evidence — run the relevant tests/build/lint if the repo supports it and quoting the output is cheap; never suppress output through tail/head/grep. Cite path:line for every concrete claim.\n\n" +
  "Return: VERDICT (pass/needs-changes/fail), the evidence, and each concrete problem (most important first) or 'none'.\n\n" + COMMS

// ─── Compose: pick the reviewer composition when the coordinator did not ───
let compositionRationale = ""
if (!panelSpecified) {
  phase("Compose")
  const picked = await agent(
    "## Choose the reviewer composition for this final review\n" + contextBlock +
    "Decide who should review this change. Return `reviewModels` — 1–5 entries of 'opus'/'fable', one reviewer each — and optionally `integratorModel` ('opus'/'fable') for the step that merges >1 verdict into the final one.\n\n" +
    "Guidance: Opus is the default and reviews most changes well. Fable is stronger but bills extra — reach for it (a Fable reviewer and/or a Fable integrator) only for HIGH-COMPLEXITY or HIGH-IMPACT changes: deep analysis of a large/existing codebase, hunting subtle long-standing bugs, or tracing the blast radius of a decision. A single ['opus'] suits a routine change; a 2–3 panel puts each reviewer on a different lens. If you put Fable on the panel, set `integratorModel` to 'fable' too so the final verdict is merged by an equal (the integrator defaults to the top tier in the panel). The integrator is ≥Opus, NEVER Sonnet.\n\n" +
    "You are only CHOOSING models — you do not review anything.\n\n" + COMMS,
    { label: "compose", phase: "Compose", model: "sonnet", schema: COMPOSE_SCHEMA }
  )
  if (picked && validModelList(picked.reviewModels)) reviewModels = picked.reviewModels
  if (!integSpecified && picked && MODEL_SET.includes(picked.integratorModel)) integratorModel = picked.integratorModel
  if (picked && picked.rationale) compositionRationale = picked.rationale
}
// Static fallback (composer omitted or failed): spend Fable sparingly.
if (!validModelList(reviewModels)) reviewModels = LEVEL === "deep" ? ["fable", "opus", "fable"] : ["opus"]
// Integrator defaults to the top tier PRESENT in the panel (never below Opus): once
// a Fable reviewer is on the panel, a Fable integrator merges the verdict as an equal.
if (!MODEL_SET.includes(integratorModel)) integratorModel = reviewModels.includes("fable") ? "fable" : "opus"
log("Composition: panel=[" + reviewModels.join(",") + "] integrator=" + integratorModel + (compositionRationale ? " — " + compositionRationale : ""))

// ─── Review ───
phase("Review")
const multi = reviewModels.length > 1
const lensesUsed = reviewModels.map((m, i) => multi ? LENSES[i % LENSES.length] : null)
const raw = await parallel(
  reviewModels.map((m, i) => () =>
    agent(reviewPrompt(lensesUsed[i]), { label: "review:" + (i + 1), phase: "Review", model: m, effort: "high", agentType: NS + "deep-reviewer", schema: REVIEW_SCHEMA })
  )
)
const candidates = []
raw.forEach((r, i) => { if (r) { r._lens = lensesUsed[i]; candidates.push(r) } })
log("Panel: " + candidates.length + " review(s) [" + reviewModels.join(",") + "]")
if (candidates.length === 0) return { error: "Review produced no verdict." }

// ─── Integrate: merge verdicts into one (≥Opus; most severe wins) ───
// A single verdict needs no merge — return it directly (no integrator), even if an
// integratorModel was named. Integrating one review is a wasted call.
let review
if (candidates.length > 1) {
  phase("Integrate")
  const block = candidates.map((c, i) =>
    "### Reviewer [" + i + "] (" + (c._lens || "whole-change") + ")\nVerdict: " + c.verdict + "\nEvidence: " + (c.evidence || "") + "\nProblems: " + (c.problems || "none")
  ).join("\n\n")
  review = await agent(
    "## Integrate the panel into ONE final verdict\n" + contextBlock +
    "You have " + candidates.length + " independent review(s) of this change. The panel has ALREADY reviewed it — TRUST their findings and do NOT re-review the change from scratch. Merge them into ONE verdict: the overall verdict is the MOST SEVERE present — `fail` beats `needs-changes` beats `pass`. Consolidate and de-duplicate the problems, keeping the most important first. Adjudicate ONLY where reviewers DISAGREE — one makes a claim another refutes; drop any claim a later reviewer convincingly refuted. When adjudicating such a DISPUTED claim you may verify that specific claim yourself if it is cheap — this is not a licence for blanket re-verification.\n\n" + block + "\n\n" +
    "Return the final VERDICT, the merged evidence, and the consolidated problems (or 'none').\n\n" + COMMS,
    { label: "integrate", phase: "Integrate", model: integratorModel, effort: "max", agentType: NS + "deep-reviewer", schema: REVIEW_SCHEMA }
  )
} else {
  review = candidates[0]
}

if (!review || !review.verdict) {
  return { error: "Review failed to produce a verdict.", candidates: candidates.map(({ _lens, ...rest }) => rest) }
}
log("Review verdict: " + review.verdict)

return {
  level: LEVEL,
  review: { verdict: review.verdict, evidence: review.evidence || "", problems: review.problems || "none" },
  candidates: candidates.map(({ _lens, ...rest }) => rest),
}
