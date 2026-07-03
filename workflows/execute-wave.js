export const meta = {
  name: "execute-wave",
  description: "Execute ONE wave of an approved plan: run each step in its own git worktree (Opus builder for substantive steps, Sonnet implementer for mechanical), merge the wave's branches back with an integrator, then verify each step against its stated intent. Called once per wave by the tiered-development skill so the coordinator stays in the loop between waves. Worktrees are used for every step when in a git repo — not only for parallel multi-step waves — to keep the coordinator's tree and its LSP diagnostics clean.",
  whenToUse: "Invoked by the tiered-development skill, once per wave. Pass args as an object: { task, wave, steps, isGit, totalSteps? } — steps are this wave's steps (each with idx, title, change, complexity, files, verify). Returns { wave, results, integration }.",
  phases: [
    { title: "Implement", detail: "Each step runs in its own worktree: Opus builder (substantive) or Sonnet implementer (mechanical)", model: "opus" },
    { title: "Integrate", detail: "Sonnet integrator merges the wave's worktree branches back into the working tree", model: "sonnet" },
    { title: "Verify", detail: "Sonnet verifier checks each step against its stated intent", model: "sonnet" },
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
if (RAW_STEPS.length === 0) return { error: "No steps given for this wave. Pass args as { task, wave, steps, isGit }." }

// Normalise steps; keep a stable idx.
const steps = RAW_STEPS.map((s, i) => ({
  idx: Number.isInteger(s.idx) ? s.idx : i,
  title: s.title || ("step " + (i + 1)),
  files: Array.isArray(s.files) ? s.files : [],
  change: s.change || "",
  complexity: s.complexity === "substantive" ? "substantive" : "mechanical",
  verify: s.verify || "",
}))
const TOTAL = Number.isInteger(A.totalSteps) && A.totalSteps > 0 ? A.totalSteps : steps.length

// Worktree isolation whenever this is a git repo — even for a single step, to keep
// the coordinator's tree/LSP clean. Shared-tree sequential is the no-git fallback.
const useWorktrees = IS_GIT

// ─── Fragments ───
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Cut filler/hedging/praise; no restating this prompt. path:line on every code claim; quote only the shortest decisive line of any command output. Keep verbatim: error strings, commands, identifiers, verdict keywords (pass/needs-changes/fail), and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`

// ─── Schemas ───
const VERDICT_SCHEMA = {
  type: "object", required: ["verdict", "evidence"],
  properties: {
    verdict: { enum: ["pass", "needs-changes", "fail"] },
    evidence: { type: "string" },
    problems: { type: "string", description: "concrete problems, most important first, or 'none'" },
  },
}
const INTEGRATE_SCHEMA = {
  type: "object", required: ["merged"],
  properties: {
    merged: { type: "integer", description: "how many worktree branches were merged into the working branch" },
    conflict: { type: "string", description: "conflicting files if any merge failed, else 'none'" },
  },
}

// ─── Prompts ───
const substantiveOf = s => s.complexity === "substantive"
const implOpts = s => {
  const base = substantiveOf(s)
    ? { label: "build:" + (s.idx + 1), phase: "Implement", model: "opus", agentType: "builder" }
    : { label: "impl:" + (s.idx + 1), phase: "Implement", model: "sonnet", agentType: "implementer" }
  return useWorktrees ? { ...base, isolation: "worktree" } : base
}
const implPrompt = s => {
  const filesLine = s.files && s.files.length ? "Files: " + s.files.join(", ") + "\n" : ""
  const judgement = substantiveOf(s)
    ? "It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report a BLOCKER."
    : "Make exactly this change — no more, and no design judgement. If it is ambiguous or impossible as written, STOP and report a BLOCKER rather than guessing."
  const wtNote = useWorktrees
    ? "\n\nYou are working in an ISOLATED git worktree that may run in parallel with sibling steps. Your worktree may NOT contain in-progress changes from those siblings; if this step turns out to need code another step was to add and you cannot find it, STOP and report a BLOCKER rather than guessing. When the change is complete, COMMIT it in this worktree with a concise message describing the step (no attribution trailer)."
    : ""
  return "## Implementation step " + (s.idx + 1) + "/" + TOTAL + " (wave " + WAVE + "): " + s.title + "\n" +
    "This is part of a larger task: " + TASK + "\n\n" + filesLine + "Change to make:\n" + s.change + "\n\n" +
    (s.verify ? "This step is done when: " + s.verify + "\n\n" : "") +
    judgement + " Match surrounding code and conventions." + wtNote + "\n\n" + COMMS
}
const verifyOne = (s, impled) =>
  agent(
    "## Verify implementation step " + (s.idx + 1) + ": " + s.title + "\n" +
    "Intended change: " + s.change + "\n" + (s.verify ? "Done when: " + s.verify + "\n" : "") +
    "\nWhat the implementer reported:\n" + (impled || "(no report returned)") + "\n\n" +
    "Check the change against its STATED intent, sceptically. Prefer evidence — run the relevant test/build/lint if cheap and quote the shortest decisive line. Return a verdict.\n\n" + COMMS,
    { label: "verify:" + (s.idx + 1), phase: "Verify", model: "sonnet", agentType: "verifier", schema: VERDICT_SCHEMA }
  )

// ─── Implement ───
phase("Implement")
const impls = await parallel(steps.map(s => () => agent(implPrompt(s), implOpts(s))))
log("wave " + WAVE + ": " + steps.length + " step(s) implemented" + (useWorktrees ? " in isolated worktree(s)" : " in the shared tree (no git)"))

// ─── Integrate (git only) ───
let integration = null
if (useWorktrees) {
  phase("Integrate")
  integration = await agent(
    "## Integrate wave " + WAVE + " worktrees\n" +
    "The implementation step(s) below ran each in its own git worktree under `.claude/worktrees/`, each committing its change on its own branch. They were designed to touch DISJOINT files, so the merges must be conflict-free.\n\n" +
    "The step(s) in this wave and the files each was to touch:\n" +
    steps.map(s => "- " + s.title + (s.files && s.files.length ? " → " + s.files.join(", ") : " → (unspecified)")).join("\n") + "\n\n" +
    "Do exactly this, from the main working tree (not a worktree):\n" +
    "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on.\n" +
    "2. For each such worktree whose branch has commits ahead of the current branch, merge that branch into the current working branch with `git merge --no-ff <branch>`.\n" +
    "3. If any merge reports a conflict, run `git merge --abort` and STOP: report the conflicting files as a BLOCKER (a conflict means the steps were not actually file-disjoint). Do not try to resolve it.\n" +
    "4. After each clean merge, remove that worktree with `git worktree remove <path>` and delete its now-merged branch.\n\n" +
    "Report how many branches you merged and any conflict.\n\n" + COMMS,
    { label: "integrate:w" + WAVE, phase: "Integrate", model: "sonnet", agentType: "implementer", schema: INTEGRATE_SCHEMA }
  )
  log("wave " + WAVE + " integrated: " + (integration ? integration.merged + " branch(es) merged" + (integration.conflict && integration.conflict !== "none" ? ", CONFLICT: " + integration.conflict : "") : "integrator returned nothing"))
}

// ─── Verify (against the integrated tree) ───
phase("Verify")
const verds = await parallel(steps.map((s, k) => () => verifyOne(s, impls[k])))

const conflict = useWorktrees && integration && integration.conflict && integration.conflict !== "none" ? integration.conflict : undefined
const results = steps.map((s, k) => {
  const v = verds[k]
  log("step " + (s.idx + 1) + "/" + TOTAL + " [" + (substantiveOf(s) ? "opus" : "sonnet") + "] (" + s.title + "): " + (v ? v.verdict : "unknown"))
  return {
    step: s.title, wave: WAVE, tier: substantiveOf(s) ? "opus" : "sonnet", worktree: useWorktrees,
    implemented: impls[k], verdict: v ? v.verdict : "unknown", evidence: v ? v.evidence : "", problems: v ? v.problems : "",
    integrationConflict: conflict,
  }
})

return { wave: WAVE, results, integration }
