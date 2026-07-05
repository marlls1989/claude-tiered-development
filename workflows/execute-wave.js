export const meta = {
  name: "execute-wave",
  description: "Execute ONE wave of an approved plan: run each step in its own git worktree (Opus builder for substantive steps, Sonnet implementer for mechanical, Haiku for menial), merge the wave's branches back with a git integrator, then a single verifier checks every step against the integrated tree. Called once per wave by the tiered-development skill so the coordinator stays in the loop between waves. Worktrees are used for every step when in a git repo — not only for parallel multi-step waves — to keep the coordinator's tree and its LSP diagnostics clean.",
  whenToUse: "Invoked by the tiered-development skill, once per wave. Pass args as an object: { task, wave, steps, isGit, totalSteps?, baseRef?, integratorModel? } — steps are this wave's steps (each with idx, title, change, complexity, files, verify). Leave a step's complexity blank to let a Sonnet composer pick its tier. Returns { wave, results, integration }.",
  phases: [
    { title: "Compose", detail: "Only when a step's tier is unspecified: a Sonnet composer picks menial/mechanical/substantive per step", model: "sonnet" },
    { title: "Implement", detail: "Each step runs in its own worktree: Haiku (menial) / Sonnet (mechanical) implementer or Opus builder (substantive)", model: "opus" },
    { title: "Integrate", detail: "Git integrator rebases the wave's worktree branches onto the working branch (linear history); Haiku by default, escalating to Sonnet on conflict or a failed (no-result) pass", model: "haiku" },
    { title: "Verify", detail: "A single Sonnet verifier checks all the wave's steps against the integrated tree", model: "sonnet" },
  ],
}

// ─── Args ───
// `args` may arrive as a parsed object or as a JSON string depending on the
// harness — normalise to an object either way.
let A = args
if (typeof A === "string") { try { A = JSON.parse(A) } catch { A = {} } }
if (!A || typeof A !== "object") A = {}
const TASK = typeof A.task === "string" ? A.task.trim() : ""
const WAVE = Number.isInteger(A.wave) && A.wave > 0 ? A.wave : 1
const RAW_STEPS = Array.isArray(A.steps) ? A.steps : []
const IS_GIT = !!A.isGit
// The commit each worktree must be reset onto. The harness cuts isolation worktrees
// from the repo's DEFAULT branch, not the checked-out one, so without this the workers
// never see the current branch's state. Empty = older coordinator; skip the reset then.
const BASE_REF = typeof A.baseRef === "string" ? A.baseRef.trim() : ""
if (!TASK) return { error: "No task given. Pass args as { task, wave, steps, isGit }." }
if (RAW_STEPS.length === 0) return { error: "No steps given for this wave. Pass args as { task, wave, steps, isGit }." }

// Git-branch integrator model: mechanical merge work, so Haiku by default; the
// coordinator may pin it to Sonnet. Anything else is a mistake — scream, don't guess.
// (Distinct from the design/review PLAN-integrator, which is ≥Opus.)
let integratorModel = "haiku"
if (A.integratorModel !== undefined && A.integratorModel !== null && A.integratorModel !== "") {
  if (!["haiku", "sonnet"].includes(A.integratorModel)) {
    return { error: "execute-wave: `integratorModel` must be 'haiku' or 'sonnet' (this is the git-branch integrator), got " + JSON.stringify(A.integratorModel) + "." }
  }
  integratorModel = A.integratorModel
}

// ─── Complexity → model tier ───
// Three tiers. The coordinator hand-authors these steps, so accept the common
// adjectives for each tier. Absent/empty complexity is a request to auto-select
// (a cheap Sonnet composer decides below); a non-empty UNRECOGNISED value is a
// mistake we refuse loudly rather than silently downgrading.
const TIER_ALIASES = {
  // menial → Haiku
  menial: "menial", trivial: "menial", rote: "menial", boilerplate: "menial",
  cosmetic: "menial", typo: "menial", minor: "menial",
  // mechanical → Sonnet
  mechanical: "mechanical", mechanic: "mechanical", simple: "mechanical",
  straightforward: "mechanical", easy: "mechanical", routine: "mechanical",
  low: "mechanical", moderate: "mechanical",
  // substantive → Opus
  substantive: "substantive", substantial: "substantive", complex: "substantive",
  hard: "substantive", high: "substantive", nontrivial: "substantive",
  "non-trivial": "substantive", difficult: "substantive", heavy: "substantive",
}
const classifyComplexity = raw => {
  if (raw === undefined || raw === null) return { status: "auto" }
  if (typeof raw !== "string") return { status: "bad" }
  const key = raw.trim().toLowerCase()
  if (key === "") return { status: "auto" }
  const tier = TIER_ALIASES[key]
  return tier ? { status: "ok", tier } : { status: "bad" }
}

// Normalise steps; keep a stable idx and carry the complexity classification.
const steps = RAW_STEPS.map((s, i) => {
  const cx = classifyComplexity(s.complexity)
  return {
    idx: Number.isInteger(s.idx) ? s.idx : i,
    title: s.title || ("step " + (i + 1)),
    files: Array.isArray(s.files) ? s.files : [],
    change: s.change || "",
    verify: s.verify || "",
    complexity: cx.status === "ok" ? cx.tier : null, // filled by the composer if "auto"
    _cx: cx,
    _raw: s.complexity,
  }
})
const TOTAL = Number.isInteger(A.totalSteps) && A.totalSteps > 0 ? A.totalSteps : steps.length

// Scream, don't guess: refuse the wave on any UNRECOGNISED (non-empty) complexity.
const badComplexity = steps.filter(s => s._cx.status === "bad")
if (badComplexity.length > 0) {
  return {
    error: "execute-wave: unrecognised `complexity` on " + badComplexity.length +
      " step(s) — REFUSING to run this wave rather than guessing the tier. " +
      "Set each to one tier, or leave it blank to let the composer pick, and re-invoke:\n" +
      badComplexity.map(s => "  - step " + (s.idx + 1) + " (" + s.title + "): complexity=" + JSON.stringify(s._raw)).join("\n") +
      "\nAccepted → menial (Haiku): menial/trivial/rote/boilerplate/cosmetic/typo/minor. " +
      "mechanical (Sonnet): mechanical/simple/straightforward/easy/routine/low/moderate. " +
      "substantive (Opus): substantive/substantial/complex/hard/high/nontrivial/difficult/heavy.",
  }
}

// Scream, don't guess: idx is the join key for composer picks and verifier verdicts,
// so duplicate values silently mis-assign results. Refuse the wave rather than run it.
const idxCounts = {}
steps.forEach(s => { idxCounts[s.idx] = (idxCounts[s.idx] || 0) + 1 })
const dup = Object.keys(idxCounts).filter(k => idxCounts[k] > 1)
if (dup.length > 0) {
  return { error: "execute-wave: duplicate step idx values (" + dup.join(", ") + ") — REFUSING to run this wave; idx is the join key for composer picks and verifier verdicts, so collisions silently mis-assign results. Give each step a unique idx and re-invoke." }
}

// Worktree isolation whenever this is a git repo — even for a single step, to keep
// the coordinator's tree/LSP clean. Shared-tree sequential is the no-git fallback.
const useWorktrees = IS_GIT

// Agent types are registered under the plugin namespace (e.g. "tiered-development:builder"),
// so `agentType` must carry the prefix — the bare name is not found.
const NS = "tiered-development:"

// ─── Fragments ───
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Cut filler/hedging/praise; no restating this prompt. path:line on every code claim; quote only the shortest decisive line of any command output. Keep verbatim: error strings, commands, identifiers, verdict keywords (pass/needs-changes/fail), and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
const SELECTION_PRINCIPLE = `Pick the cheapest tier that will reliably get the step right, weighing the judgement it needs against the cost of getting it wrong (subtle, hard-to-catch, or wide blast radius). menial = a cheap edit that is obvious if wrong (rename, typo, boilerplate). mechanical = routine work with settled instructions. substantive = needs implementation judgement, or a silent error would be expensive. Err upward when a mistake would be costly.`

// ─── Schemas ───
const TIER_PICK_SCHEMA = {
  type: "object", required: ["tiers"],
  properties: {
    tiers: {
      type: "array",
      items: {
        type: "object", required: ["idx", "complexity"],
        properties: {
          idx: { type: "integer", description: "the step's idx, exactly as given" },
          complexity: { enum: ["menial", "mechanical", "substantive"] },
        },
      },
    },
    rationale: { type: "string", description: "one line on the calls made" },
  },
}
const WAVE_VERDICT_SCHEMA = {
  type: "object", required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object", required: ["idx", "verdict"],
        properties: {
          idx: { type: "integer", description: "the step's idx, exactly as given" },
          verdict: { enum: ["pass", "needs-changes", "fail"] },
          evidence: { type: "string" },
          problems: { type: "string", description: "concrete problems, most important first, or 'none'" },
        },
      },
    },
  },
}
const INTEGRATE_SCHEMA = {
  type: "object", required: ["merged"],
  properties: {
    merged: { type: "integer", description: "how many worktree branches were merged into the working branch" },
    conflict: { type: "string", description: "conflicting files if any merge failed, else 'none'" },
  },
}

// ─── Compose: pick tiers for steps left unspecified ───
const autoSteps = steps.filter(s => s._cx.status === "auto")
if (autoSteps.length > 0) {
  phase("Compose")
  const picked = await agent(
    "## Choose the build tier for " + autoSteps.length + " step(s) of wave " + WAVE + "\n" +
    "Part of a larger task: " + TASK + "\n\n" +
    "For EACH step below, choose its tier — `menial`, `mechanical`, or `substantive`. " +
    SELECTION_PRINCIPLE + "\n\n" +
    "You are only CHOOSING the tier; you do not implement anything. Return a tier per step, keyed by the given idx.\n\n" +
    autoSteps.map(s => "### idx " + s.idx + " — " + s.title + "\n" + s.change + (s.files.length ? "\nFiles: " + s.files.join(", ") : "") + (s.verify ? "\nDone when: " + s.verify : "")).join("\n\n") +
    "\n\n" + COMMS,
    { label: "compose:w" + WAVE, phase: "Compose", model: "sonnet", schema: TIER_PICK_SCHEMA }
  )
  const byIdx = {}
  if (picked && Array.isArray(picked.tiers)) picked.tiers.forEach(t => { byIdx[t.idx] = t.complexity })
  // Fall back to mechanical (Sonnet) for any the composer skipped — the safe middle.
  autoSteps.forEach(s => { s.complexity = byIdx[s.idx] || "mechanical" })
  log("wave " + WAVE + " composer picked tiers: " + autoSteps.map(s => (s.idx + 1) + "→" + s.complexity).join(", ") + (picked && picked.rationale ? " — " + picked.rationale : ""))
}

// ─── Tier routing ───
const TIER = {
  menial: { model: "haiku", agentType: NS + "implementer", name: "haiku" },
  mechanical: { model: "sonnet", agentType: NS + "implementer", name: "sonnet" },
  substantive: { model: "opus", agentType: NS + "builder", name: "opus" },
}
const tierOf = s => TIER[s.complexity] || TIER.mechanical

// ─── Prompts ───
const implOpts = s => {
  const t = tierOf(s)
  const base = {
    label: (s.complexity === "substantive" ? "build:" : "impl:") + (s.idx + 1),
    phase: "Implement", model: t.model, agentType: t.agentType,
  }
  return useWorktrees ? { ...base, isolation: "worktree" } : base
}
const implPrompt = s => {
  const filesLine = s.files && s.files.length ? "Files: " + s.files.join(", ") + "\n" : ""
  const judgement = s.complexity === "substantive"
    ? "It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report a BLOCKER."
    : "Make exactly this change — no more, and no design judgement. If it is ambiguous or impossible as written, STOP and report a BLOCKER rather than guessing."
  const resetNote = useWorktrees && BASE_REF
    ? "\n\nThis worktree was created by the harness from the repository's DEFAULT branch, which is the WRONG base for this work. BEFORE reading or editing anything, run `git reset --hard " + BASE_REF + "` so your work builds on the intended commit (its objects are already present in the shared repo). If that command fails, or the files/API this step depends on are still missing afterward, STOP and report a BLOCKER rather than guessing."
    : ""
  const wtNote = useWorktrees
    ? resetNote + "\n\nYou are working in an ISOLATED git worktree that may run in parallel with sibling steps. Your worktree may NOT contain in-progress changes from those siblings; if this step turns out to need code another step was to add and you cannot find it, STOP and report a BLOCKER rather than guessing. When the change is complete, COMMIT it in this worktree with a concise message describing the step (no attribution trailer)."
    : ""
  return "## Implementation step " + (s.idx + 1) + "/" + TOTAL + " (wave " + WAVE + "): " + s.title + "\n" +
    "This is part of a larger task: " + TASK + "\n\n" + filesLine + "Change to make:\n" + s.change + "\n\n" +
    (s.verify ? "This step is done when: " + s.verify + "\n\n" : "") +
    judgement + " Match surrounding code and conventions." + wtNote + "\n\n" + COMMS
}

// ─── Implement ───
phase("Implement")
const impls = await parallel(steps.map(s => () => agent(implPrompt(s), implOpts(s))))
// A crashed/empty implementer should read identically in the verify prompt and the results.
const implReport = k => impls[k] || "(no report returned)"
log("wave " + WAVE + ": " + steps.length + " step(s) implemented" + (useWorktrees ? " in isolated worktree(s)" : " in the shared tree (no git)"))

// ─── Integrate (git only) ───
const integratePrompt = reason =>
  "## Integrate wave " + WAVE + " worktrees\n" +
  (reason === "conflict"
    ? "A cheaper first pass hit a CONFLICT and aborted, leaving the tree clean. Re-attempt carefully — a cheap model may have mis-merged. If the branches genuinely conflict, abort and report EXACTLY which files/hunks conflict.\n\n"
    : reason === "nothing"
    ? "A cheaper first pass returned NO result and may have left the working tree mid-merge, dirty, or with some branches already merged. BEFORE integrating anything, run `git status`; if a merge or rebase is in progress, complete it or abort it (`git merge --abort` / `git rebase --abort`) and reconcile any partial state; only then proceed with the remaining un-merged branches. If the tree state is unclear or cannot be made clean, STOP and report a BLOCKER rather than guessing.\n\n"
    : "") +
  "The implementation step(s) below ran each in its own git worktree under `.claude/worktrees/`, each committing its change on its own branch. They were designed to touch DISJOINT files, so rebasing them onto the working branch must be conflict-free.\n\n" +
  "The step(s) in this wave and the files each was to touch:\n" +
  steps.map(s => "- " + s.title + (s.files && s.files.length ? " → " + s.files.join(", ") : " → (unspecified)")).join("\n") + "\n\n" +
  "Do exactly this, from the main working tree (not a worktree):\n" +
  "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on.\n" +
  "2. Integrate them ONE AT A TIME, keeping history LINEAR (do NOT create merge commits): for each worktree whose branch is ahead of the current working branch, first replay that branch onto the up-to-date working branch by running, from inside the worktree, `git -C <worktree-path> rebase <current-branch>`; then, from the main working tree, fast-forward with `git merge --ff-only <branch>`.\n" +
  "3. If the rebase reports a conflict, run `git -C <worktree-path> rebase --abort` and STOP: report the conflicting files as a BLOCKER (a conflict means the steps were not actually file-disjoint). Do not try to resolve it.\n" +
  "4. After each successful fast-forward, remove that worktree with `git worktree remove <path>` and delete its now-integrated branch.\n\n" +
  "Report how many branches you integrated and any conflict.\n\n" + COMMS
const runIntegrator = (model, reason) =>
  agent(integratePrompt(reason), {
    label: "integrate:w" + WAVE + (model !== integratorModel ? ":" + model : ""),
    phase: "Integrate", model, agentType: NS + "implementer", schema: INTEGRATE_SCHEMA,
  })
const conflicted = r => r && r.conflict && r.conflict !== "none"
// A conflict OR a null/empty result both warrant a more capable retry.
const needsRetry = r => !r || conflicted(r)

let integration = null
if (useWorktrees) {
  phase("Integrate")
  integration = await runIntegrator(integratorModel, null)
  // Scale up on trouble: a cheap merge that hit a conflict or returned nothing gets a more capable retry.
  if (needsRetry(integration) && integratorModel === "haiku") {
    log("wave " + WAVE + " integrate " + (integration ? "hit a conflict" : "returned nothing") + " on haiku — escalating to sonnet")
    const esc = await runIntegrator("sonnet", conflicted(integration) ? "conflict" : "nothing")
    if (esc) integration = esc
  }
  // Never leave integration null: the wave could not be confirmed merged. A non-'none'
  // conflict here trips the coordinator's stop-on-conflict path via `conflicted`.
  // merged:0 is a floor, not a fact: a crashed integrator may have merged some branches before dying, so this understates the true count. `failed:true` — not the conflict string — is the authoritative crash signal; downstream should key on `failed`, not a conflict-string match.
  if (!integration) integration = { merged: 0, conflict: "integrator returned no result — the wave could not be confirmed merged", failed: true }
  log("wave " + WAVE + " integrated: " + integration.merged + " branch(es) merged" + (conflicted(integration) ? ", CONFLICT: " + integration.conflict : ""))
}

// ─── Verify (one verifier over the whole integrated tree) ───
phase("Verify")
const waveVerdict = await agent(
  "## Verify wave " + WAVE + " against the integrated tree\n" +
  "This is part of a larger task: " + TASK + "\n\n" +
  "All the step(s) below have been merged into the current working tree. Check EACH against its STATED intent, sceptically — and look for interactions BETWEEN them that a per-file review would miss (an assumption that holds in one step but not once another lands). Prefer evidence: run the relevant build/test/lint once if cheap and quote the shortest decisive line. Return a verdict PER STEP, keyed by the given idx.\n\n" +
  steps.map((s, k) =>
    "### idx " + s.idx + " — " + s.title + "\n" +
    "Intended change: " + s.change + (s.verify ? "\nDone when: " + s.verify : "") +
    (s.files.length ? "\nFiles: " + s.files.join(", ") : "") +
    "\nImplementer reported:\n" + implReport(k)
  ).join("\n\n") + "\n\n" + COMMS,
  { label: "verify:w" + WAVE, phase: "Verify", model: "sonnet", agentType: NS + "verifier", schema: WAVE_VERDICT_SCHEMA }
)
const verdByIdx = {}
if (waveVerdict && Array.isArray(waveVerdict.results)) waveVerdict.results.forEach(r => { verdByIdx[r.idx] = r })

const conflict = useWorktrees && conflicted(integration) ? integration.conflict : undefined
const results = steps.map((s, k) => {
  const v = verdByIdx[s.idx]
  log("step " + (s.idx + 1) + "/" + TOTAL + " [" + tierOf(s).name + "] (" + s.title + "): " + (v ? v.verdict : "unknown"))
  return {
    step: s.title, wave: WAVE, tier: tierOf(s).name, worktree: useWorktrees,
    implemented: implReport(k), verdict: v ? v.verdict : "unknown", evidence: v ? (v.evidence || "") : "", problems: v ? (v.problems || "") : "",
    integrationConflict: conflict,
  }
})

return { wave: WAVE, results, integration }
