export const meta = {
  name: "execute-wave",
  description: "Execute ONE wave of an approved plan: a mandatory Sonnet composer declares an ORDERED list of BATCHES of PARALLEL JOBS — each job one worker running one or more tasks sequentially in its own git worktree (Opus builder for substantive, Sonnet/Haiku implementer for mechanical/menial) — and a dumb scheduler executes exactly that declaration: batches in sequence, a batch's jobs in parallel, with no dependency evaluation and no file-overlap serialisation (parallel jobs may share a file by design; the integrator reconciles). Between batches a Sonnet integrator merges that batch's branches so the next batch builds on the committed result. A final Sonnet integrator/verifier merges the last batch's branches — resolving any conflict in place against the steps' stated intent — verifies every step against the integrated tree, and on a GREEN wave (optionally gated on the project's green bar) squashes it into one commit. Called once per wave by the tiered-development skill so the coordinator stays in the loop between waves. Worktrees are used whenever in a git repo to keep the coordinator's tree and its LSP diagnostics clean.",
  whenToUse: "Invoked by the tiered-development skill, once per wave. Pass args as an object: { task, wave, steps, isGit, totalSteps?, baseRef?, greenBar? } — steps are this wave's steps (each with idx, title, change, complexity, files, verify, dependsOn). Leave a step's complexity blank to let the composer pick its tier; a step's dependsOn is ADVISORY input — the composer has the FINAL word, declaring an ordered list of batches of parallel jobs (tightly-dependent tasks merged into one job). Returns { wave, results, integration }.",
  phases: [
    { title: "Compose", detail: "Mandatory: a Sonnet composer declares an ordered list of batches of parallel jobs (merging tightly-dependent tasks into one job, bundling similar cheap tasks) and tiers each job", model: "sonnet" },
    { title: "Implement", detail: "Batches run in declared order: each job runs in its own worktree — Haiku (menial) / Sonnet (mechanical) implementer or Opus builder (substantive) — with a Sonnet integrator merging each non-final batch before the next batch dispatches onto its committed tip", model: "opus" },
    { title: "Integrate & verify", detail: "A single Sonnet integrator/verifier merges the final batch's worktree branches into the working branch, resolving any conflict in place, verifies every step against the integrated tree (diffing against the kept worktrees to pinpoint merge faults), and on a GREEN wave squashes it into one summary commit", model: "sonnet" },
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
// The wave's green bar — the standard a dependent worker's integrated base must meet before
// it is dispatched. Consumed by the later dispatch step; captured here alongside the args.
const GREEN_BAR = typeof A.greenBar === "string" ? A.greenBar.trim() : ""
if (!TASK) return { error: "No task given. Pass args as { task, wave, steps, isGit }." }
if (RAW_STEPS.length === 0) return { error: "No steps given for this wave. Pass args as { task, wave, steps, isGit }." }

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
    dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.filter(Number.isInteger) : [],
    complexity: cx.status === "ok" ? cx.tier : null, // filled by the composer if "auto"
    _cx: cx,
    _raw: s.complexity,
  }
})

// In-wave dependency edges. `dependsOn` is ADVISORY — shown to the composer as the planner's
// suggestion; nothing is scheduled from it. Keep only the refs that point at another step IN THIS
// WAVE. A ref to an earlier wave's step is already built and integrated (treated as already
// satisfied); a self-ref is meaningless. Dedupe as we go.
const idxSet = new Set(steps.map(s => s.idx))
steps.forEach(s => {
  const uniq = [...new Set(s.dependsOn)]
  if (uniq.includes(s.idx)) log("wave " + WAVE + ": step " + s.idx + " dependsOn itself — self-ref dropped")
  s.deps = uniq.filter(d => {
    if (d === s.idx) return false
    if (idxSet.has(d)) return true
    log("wave " + WAVE + ": step " + s.idx + " dependsOn " + d + " — not in this wave, treated as satisfied by an earlier wave")
    return false
  })
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

// ─── Resilient agent call ───
// A schema-carrying agent() THROWS when the worker never produces valid StructuredOutput
// ('StructuredOutput retry cap (5) exceeded'). That must degrade to a wave-level failure in
// the returned shape, never crash the whole Workflow. Returns the agent's result, or null
// after recording the crash reason in agentCrash. agentCrash is reset per call and is safe
// only because every safeAgent call is individually awaited — never use it inside parallel().
let agentCrash = null
const safeAgent = async (prompt, opts) => {
  agentCrash = null
  try { return await agent(prompt, opts) } catch (e) {
    agentCrash = e && e.message ? String(e.message) : String(e)
    log("wave " + WAVE + " " + (opts && opts.label ? opts.label : "agent") + " CRASHED: " + agentCrash)
    return null
  }
}

// ─── Fragments ───
const COMMS = `Comms: your final message is DATA returned to the coordinator, not prose for a human. Cut filler/hedging/praise; no restating this prompt. path:line on every code claim; quote only the shortest decisive line of any command output. Keep verbatim: error strings, commands, identifiers, verdict keywords (pass/needs-changes/fail/blocked), and the markers BLOCKER/QUESTION. Never compress a BLOCKER/QUESTION explanation or a security caveat — spell those out plainly. See skills/tiered-development/comms-protocol.md.`
const SELECTION_PRINCIPLE = `Pick the cheapest tier that will reliably get the step right, weighing the judgement it needs against the cost of getting it wrong (subtle, hard-to-catch, or wide blast radius). menial = a cheap edit that is obvious if wrong (rename, typo, boilerplate). mechanical = routine work with settled instructions. substantive = needs implementation judgement, or a silent error would be expensive. Err upward when a mistake would be costly.`

// ─── Schemas ───
const BATCHES_SCHEMA = {
  type: "object", required: ["batches"],
  properties: {
    batches: {
      type: "array",
      description: "ordered list of batches, in execution order; batches run in SEQUENCE, each onto the integrated result of the one before; the jobs inside a batch run in PARALLEL",
      items: {
        type: "object", required: ["jobs"],
        properties: {
          jobs: {
            type: "array",
            items: {
              type: "object", required: ["tasks", "complexity"],
              properties: {
                tasks: {
                  type: "array", items: { type: "integer" },
                  description: "idx values of the task(s) this ONE worker does sequentially in ONE worktree, in the order listed; every idx covered exactly once across all jobs",
                },
                complexity: { enum: ["menial", "mechanical", "substantive"] },
              },
            },
          },
        },
      },
    },
    rationale: { type: "string", description: "one line on the batching + tier calls" },
  },
}
const WAVE_SCHEMA = {
  type: "object", required: ["merged", "results"],
  properties: {
    merged: { type: "integer", description: "how many worktree branches were merged into the working branch (0 if none / non-git)" },
    resolved: { type: "string", description: "files where a merge conflict was encountered and RESOLVED in place, else 'none' — a risk point the verification scrutinises" },
    conflict: { type: "string", description: "files with a conflict you could NOT resolve (merge abandoned, BLOCKER), else 'none'" },
    squashed: { type: "boolean", description: "true ONLY if the wave passed GREEN and was collapsed into ONE commit; false/absent otherwise" },
    summary: { type: "string", description: "on a GREEN wave, the one-line message used for the single squashed wave commit; else 'none'" },
    results: {
      type: "array",
      items: {
        type: "object", required: ["idx", "verdict"],
        properties: {
          idx: { type: "integer", description: "the step's idx, exactly as given" },
          verdict: { enum: ["pass", "needs-changes", "fail", "blocked"] },
          evidence: { type: "string" },
          problems: { type: "string", description: "concrete problems, most important first, or 'none'; for a 'blocked' verdict, the verbatim QUESTION/BLOCKER text — what was checked and exactly what could not be determined" },
        },
      },
    },
  },
}
// Per-batch integrator (non-final batches, git only): merge just that batch's branches and report
// the new tip; batch 1 also records the pre-merge HEAD as the wave's squash base.
const BATCH_SCHEMA = {
  type: "object", required: ["merged", "tip"],
  properties: {
    merged: { type: "integer", description: "how many of THIS batch's worker branches were merged into the working branch" },
    resolved: { type: "string", description: "files where a conflict was resolved in place, else none" },
    conflict: { type: "string", description: "files you could NOT resolve — merge abandoned, BLOCKER — else none" },
    start: { type: "string", description: "batch 1 ONLY: the pre-merge HEAD sha recorded BEFORE merging anything" },
    tip: { type: "string", description: "the post-merge HEAD sha — git rev-parse HEAD after the last ff merge" },
  },
}

// ─── Job helpers ───
// The unit of implementation is a JOB — one worker, one worktree, doing every task in it in the
// order given; verification stays per-step (per idx).
const TIER_ORDER = { menial: 0, mechanical: 1, substantive: 2 }
const maxTier = (...ts) => { const v = ts.filter(Boolean); return v.length ? v.sort((a, b) => TIER_ORDER[b] - TIER_ORDER[a])[0] : null }
const floorOf = s => (s._cx.status === "ok" ? s._cx.tier : null) // an explicit complexity is a FLOOR, else null (composer decides)
const makeJob = (members, complexity) => {
  const cx = complexity || "mechanical" // safe middle, matches the old per-step fallback
  const ordered = [...members] // the caller's order is authoritative (composer-listed task order)
  const idxs = ordered.map(m => m.idx)
  const files = [...new Set(ordered.flatMap(m => m.files))]
  const label = (cx === "substantive" ? "build:" : "impl:") + idxs.map(i => i + 1).join("+")
  const title = ordered.length === 1 ? ordered[0].title
    : ordered.length + " steps: " + ordered.map(m => m.title).join("; ")
  ordered.forEach(m => { m.complexity = cx }) // a step's tier is its worker's tier (keeps per-step tierOf/results correct)
  return { members: ordered, idxs, complexity: cx, files, label, title }
}

// The composer's declaration IS the schedule; buildBatches validates coverage + tier floors +
// non-emptiness, nothing more (the scheduler is dumb — no dependency evaluation, no file-overlap serialisation).
const buildBatches = picked => {
  const byValue = new Map(steps.map(s => [s.idx, s]))
  const refuse = detail => ({ error: "execute-wave: composer declared invalid batches — REFUSING to run this wave rather than guessing the dispatch: " + detail + ". Re-invoke to retry the composer." })
  const batches = picked && Array.isArray(picked.batches) ? picked.batches : []
  if (batches.length === 0) return refuse("no batches were returned")
  const seen = new Set()
  const jobs = []
  for (let b = 0; b < batches.length; b++) {
    const rawJobs = batches[b] && Array.isArray(batches[b].jobs) ? batches[b].jobs : []
    if (rawJobs.length === 0) return refuse("batch " + (b + 1) + " has no jobs")
    for (const j of rawJobs) {
      const pick = ["menial", "mechanical", "substantive"].includes(j && j.complexity) ? j.complexity : null
      const tasks = Array.isArray(j && j.tasks) ? j.tasks.filter(Number.isInteger) : []
      if (tasks.length === 0) return refuse("batch " + (b + 1) + " has a job with no integer tasks")
      const members = [] // idx values mapped to steps IN LISTED ORDER — the composer's order is authoritative
      for (const idx of tasks) {
        if (!byValue.has(idx)) return refuse("batch " + (b + 1) + " references idx " + idx + ", not a step in this wave")
        if (seen.has(idx)) return refuse("idx " + idx + " is covered by more than one job")
        seen.add(idx); members.push(byValue.get(idx))
      }
      jobs.push(Object.assign(makeJob(members, maxTier(pick, ...members.map(floorOf))), { batch: b + 1 }))
    }
  }
  const uncovered = steps.filter(s => !seen.has(s.idx)).map(s => s.idx)
  if (uncovered.length) return refuse("wave idx " + uncovered.join(", ") + " left uncovered by any job")
  return { jobs }
}

// ─── Compose: MANDATORY — declare an ordered list of batches of parallel jobs AND tier each job.
// Nothing to decide only when there's a single step whose tier is already set: it is its own job.
const needCompose = steps.length > 1 || steps.some(s => s._cx.status === "auto")
let jobs
if (!needCompose) {
  jobs = [Object.assign(makeJob([steps[0]], floorOf(steps[0])), { batch: 1 })]
} else {
  phase("Compose")
  const picked = await safeAgent(
    "## Batch the " + steps.length + " task(s) of wave " + WAVE + "\n" +
    "Part of a larger task: " + TASK + "\n\n" +
    "Group this wave's tasks into an ORDERED list of BATCHES. Batches run in SEQUENCE, each dispatched onto the integrated result of the one before; the jobs inside a batch run in PARALLEL. Each job is ONE worker in ONE git worktree doing one or more tasks sequentially, in the order you list them. You are only PLANNING the dispatch; you do not implement anything.\n\n" +
    "Rules (obey exactly):\n" +
    "- COVER every task's idx EXACTLY ONCE across all jobs. Never split a single task across jobs.\n" +
    "- You have the FINAL word on order and execution. A task's 'Advisory dependency' below is the planner's suggestion — honour it when it is real, override it when it is not.\n" +
    "- Bias toward FEW jobs: MERGE sequential dependents that do NOT build on a prior PARALLEL fan-out into ONE worker, in dependency order; prefer grouping SIMILAR tasks together. Mixing tiers is fine — the merged job's tier is the MAX floor of its tasks (see the FLOOR rule below).\n" +
    "- INDEPENDENT tasks belong in the SAME batch as separate parallel jobs — EVEN IF they touch the same file. The integrator resolves same-file overlap; file overlap is NEVER a reason to serialise or merge — only tight dependency is.\n" +
    "- Start a LATER batch ONLY to build on a prior batch's integrated PARALLEL fan-out of TWO OR MORE jobs. A dependency on a SINGLE earlier job is NOT a batch boundary — fold the dependent into that same job.\n" +
    "- A task's current tier is a FLOOR: never tier a job BELOW any of its tasks' stated tiers. You may raise a blank/cheap task to its job's tier when you bundle it.\n" +
    SELECTION_PRINCIPLE + "\n\n" +
    "Return `batches` in execution order — each { jobs: [ { tasks: [idx, ...], complexity } ] } — covering every idx below exactly once.\n\n" +
    steps.map(s => "### idx " + s.idx + " — " + s.title + " [tier: " + (floorOf(s) || "auto") + "]\n" +
      s.change + (s.files.length ? "\nFiles: " + s.files.join(", ") : "") + (s.verify ? "\nDone when: " + s.verify : "") +
      (s.deps.length ? "\nAdvisory dependency (planner's suggestion — you may override): idx " + s.deps.join(", ") : "")
    ).join("\n\n") + "\n\n" + COMMS,
    { label: "compose:w" + WAVE, phase: "Compose", model: "sonnet", schema: BATCHES_SCHEMA }
  )
  if (picked === null && agentCrash) return { error: "execute-wave: composer crashed (" + agentCrash + ") — no batches declared; re-invoke to retry the wave." }
  const built = buildBatches(picked)
  if (built.error) return { error: built.error }
  jobs = built.jobs
  const batchCount = Math.max(...jobs.map(j => j.batch))
  log("wave " + WAVE + " composer declared " + batchCount + " batch(es), " + jobs.length + " job(s): " +
      jobs.map(j => "b" + j.batch + ":" + j.label).join(", ") + (picked && picked.rationale ? " — " + picked.rationale : ""))
}
const jobByIdx = {}
jobs.forEach(g => g.idxs.forEach(idx => { jobByIdx[idx] = g }))

// ─── Tier routing ───
const TIER = {
  menial: { model: "haiku", agentType: NS + "implementer", name: "haiku" },
  mechanical: { model: "sonnet", agentType: NS + "implementer", name: "sonnet" },
  substantive: { model: "opus", agentType: NS + "builder", name: "opus" },
}
const tierOf = g => TIER[g.complexity] || TIER.mechanical // takes a job (or a step — makeJob sets each member's complexity)

// ─── Prompts ───
const implOpts = g => {
  const t = tierOf(g)
  const base = { label: g.label, phase: "Implement", model: t.model, agentType: t.agentType }
  return useWorktrees ? { ...base, isolation: "worktree" } : base
}
const implPrompt = (g, baseSha) => {
  const judgement = g.complexity === "substantive"
    ? "It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report a BLOCKER."
    : "Make exactly these change(s) — no more, and no design judgement. If any is ambiguous or impossible as written, STOP and report a BLOCKER rather than guessing."
  // Batch-1 workers reset onto BASE_REF (the coordinator's tip); batch>=2 workers reset onto the
  // integrated TIP of the prior batch, which already CONTAINS every earlier batch's committed work.
  const resetNote = !useWorktrees
    ? ""
    : g.batch >= 2
      ? "\n\nThis worktree was created by the harness from the repository's DEFAULT branch, which is the WRONG base for this work. BEFORE reading or editing anything, run `git reset --hard " + baseSha + "` — this commit already CONTAINS the committed, integrated result of every EARLIER batch of this wave; build on the actual tree state, do not re-do that work. If that command fails, or the code you depend on is missing afterward, STOP and report a BLOCKER."
      : baseSha
        ? "\n\nThis worktree was created by the harness from the repository's DEFAULT branch, which is the WRONG base for this work. BEFORE reading or editing anything, run `git reset --hard " + baseSha + "` so your work builds on the intended commit (its objects are already present in the shared repo). If that command fails, or the files/API this work depends on are still missing afterward, STOP and report a BLOCKER rather than guessing."
        : ""
  const wtNote = useWorktrees
    ? resetNote + "\n\nYou are working in an ISOLATED git worktree that may run in parallel with sibling SAME-BATCH workers. Your worktree may NOT contain in-progress changes from those siblings; a sibling MAY be editing the SAME file as you — that is by design: make only YOUR stated change(s), do not anticipate or work around theirs (a batch integrator reconciles afterwards); if this work turns out to need code another worker was to add and you cannot find it, STOP and report a BLOCKER rather than guessing. When ALL the change(s) below are complete, COMMIT them in this worktree in a SINGLE commit with a concise message describing the work (no attribution trailer)."
    : ""
  const multi = g.members.length > 1
  const body = multi
    ? "## Implementation (wave " + WAVE + "): " + g.members.length + " related steps in one worktree\n" +
      "This is part of a larger task: " + TASK + "\n\n" +
      "Do ALL of the following steps in this one worktree, in order; keep each edit scoped to exactly what that step asks:\n\n" +
      g.members.map(m => "**Step " + (m.idx + 1) + "/" + TOTAL + " — " + m.title + "**\n" +
        (m.files.length ? "Files: " + m.files.join(", ") + "\n" : "") + m.change +
        (m.verify ? "\nDone when: " + m.verify : "")).join("\n\n") + "\n\n"
    : (() => {
        const s = g.members[0]
        return "## Implementation step " + (s.idx + 1) + "/" + TOTAL + " (wave " + WAVE + "): " + s.title + "\n" +
          "This is part of a larger task: " + TASK + "\n\n" +
          (s.files.length ? "Files: " + s.files.join(", ") + "\n" : "") + "Change to make:\n" + s.change + "\n\n" +
          (s.verify ? "This step is done when: " + s.verify + "\n\n" : "")
      })()
  return body + judgement + " Match surrounding code and conventions." + wtNote + "\n\n" + COMMS
}

// ─── Integrate helpers ───
const conflicted = r => r && r.conflict && r.conflict !== "none"
const validSha = s => typeof s === "string" && /^[0-9a-f]{7,40}$/i.test(s.trim())
const jobLine = g => "- " + g.label + " [" + g.members.map(m => m.title).join("; ") + "]" + (g.files.length ? " → " + g.files.join(", ") : " → (unspecified)")

// A NON-final batch's branches are merged NOW (git only) so the next batch's workers can reset onto
// committed work. Same rebase/ff-only/resolve rules as the final integrator, but it keeps EVERY
// worktree for the final diff. Batch 1 also records the pre-merge HEAD as the wave's squash base.
const batchIntegratePrompt = (batch, bjobs, priorJobs) =>
  "## Integrate batch " + batch + " of wave " + WAVE + "\n" +
  "This is part of a larger task: " + TASK + "\n\n" +
  (priorJobs.length
    ? "Batches 1–" + (batch - 1) + " of this wave were ALREADY integrated onto the working branch by earlier per-batch integrators — they are already on the working branch, do NOT re-apply them. Already-integrated worker(s):\n" +
      priorJobs.map(jobLine).join("\n") + "\n\n"
    : "") +
  "PENDING — batch " + batch + "'s worker(s) each ran in their own git worktree under `.claude/worktrees/`, committing on their own branch (a worker may cover several bundled steps in one commit). Integrate ONLY these branches into the main working branch now, so the NEXT batch's workers build on the committed result. The worker(s) and the files each touched:\n" +
  bjobs.map(jobLine).join("\n") + "\n\n" +
  "Do this from the main working tree (not a worktree):\n" +
  (batch === 1
    ? "0. BEFORE anything else, capture the pre-merge HEAD as the wave's squash base: run `git rev-parse HEAD` and RECORD the literal sha it prints into `start` (do not rely on a shell variable persisting between commands — note the actual sha; later batches merge on top of it). Then run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER.\n"
    : "0. Run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER. Earlier batches are already committed on this branch — leave `start` empty.\n") +
  "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on. Match each PENDING branch to a worker above by the union of files it touched; any already-integrated prior-batch worktrees are still present but their branches are ancestors of the working branch — do NOT re-apply them.\n" +
  "2. Integrate ONLY THIS batch's PENDING branches ONE AT A TIME (do NOT create merge commits): for each such worktree whose branch is ahead of the working branch, replay it with `git -C <worktree-path> rebase <current-branch>`, then from the main working tree fast-forward with `git merge --ff-only <branch>`.\n" +
  "3. If a rebase reports a CONFLICT, RESOLVE it in place rather than returning to the coordinator: reconcile the two sides so BOTH workers' stated intent is honoured (parallel jobs MAY share a file BY DESIGN — a conflict here is EXPECTED, not a planning error; reconcile so BOTH jobs' stated intent is honoured, never silently drop one side), then complete the rebase. Add every such file to `resolved`. ONLY if the correct reconciliation is genuinely ambiguous — you would have to guess intent — run `git -C <worktree-path> rebase --abort`, set `conflict` to those files, STOP the merge, and report a BLOCKER; do not guess.\n" +
  "4. Do NOT remove any worktree — later batches and the final verification need them.\n" +
  "Set `merged` to how many branches you integrated, `resolved` to the files you resolved a conflict in (or 'none'), `conflict` to any files you could not resolve (or 'none'), and `tip` to the post-merge HEAD sha (run `git rev-parse HEAD` after the last fast-forward).\n\n" +
  COMMS

// ─── Implement (batched dispatch) ───
// jobs carry the composer's 1-based `batch`; dispatch batch by batch, batch 1 onto BASE_REF, later
// batches onto the prior batch's integrated TIP; the scheduler is DUMB, executing exactly the declared
// batches (no dependency evaluation, no file-overlap serialisation). Between batches (git only) a Sonnet
// integrator merges that batch's branches and reports the new TIP; the final batch is integrated and
// verified below. Non-git: the same batch order runs in the shared tree, no integrators.
phase("Implement")
const maxBatch = Math.max(...jobs.map(j => j.batch))
const impls = new Array(jobs.length)
let START = null, TIP = null, mergedSoFar = 0
const resolvedParts = [], conflictParts = []
let abort = null // { batch, reason, crash, files } — set to STOP dispatching further batches
for (let batch = 1; batch <= maxBatch && !abort; batch++) {
  const batchEntries = jobs.map((g, k) => ({ g, k })).filter(e => e.g.batch === batch)
  const base = batch === 1 ? BASE_REF : TIP
  // Git path: worktree isolation + integrators reconcile, so a batch's jobs run in PARALLEL.
  // Non-git fallback: no worktree isolation and no batch integrator runs, so parallel same-file
  // jobs would clobber each other in the shared tree — run this batch's jobs SEQUENTIALLY in
  // declared order instead (same result array shape/order either way).
  let batchResults
  if (useWorktrees) {
    batchResults = await parallel(batchEntries.map(e => () => agent(implPrompt(e.g, base), implOpts(e.g))))
  } else {
    batchResults = []
    for (const e of batchEntries) batchResults.push(await agent(implPrompt(e.g, base), implOpts(e.g)))
  }
  batchEntries.forEach((e, j) => { impls[e.k] = batchResults[j] }) // keep each job's original array position
  log("wave " + WAVE + " batch " + batch + "/" + maxBatch + ": " + batchEntries.length + " worker(s) [" +
      batchEntries.map(e => e.g.label).join(", ") + "]" + (useWorktrees ? " onto " + (base || "(no base ref)") : " (shared tree)"))
  // Integrate every NON-final batch now (git only) so the next batch resets onto committed work.
  if (batch === maxBatch || !useWorktrees) continue
  const si = await safeAgent(batchIntegratePrompt(batch, batchEntries.map(e => e.g), jobs.filter(j => j.batch < batch)),
    { label: "integrate:w" + WAVE + ":b" + batch, phase: "Implement", model: "sonnet", agentType: NS + "verifier", schema: BATCH_SCHEMA })
  if (batch === 1) START = validSha(si && si.start) ? si.start.trim() : (BASE_REF || null)
  if (si && Number.isInteger(si.merged)) mergedSoFar += si.merged
  if (si && si.resolved && si.resolved !== "none") resolvedParts.push(si.resolved)
  if (si && si.conflict && si.conflict !== "none") conflictParts.push(si.conflict)
  if (!si) abort = { batch, reason: (agentCrash ? "batch integrator crashed (" + agentCrash + ")" : "batch integrator returned no result") + " — the wave could not be confirmed merged", crash: true }
  else if (conflicted(si)) abort = { batch, reason: "unresolved conflict in " + si.conflict, files: si.conflict }
  else if (!validSha(si.tip)) abort = { batch, reason: "batch integrator returned no valid tip sha — the wave could not be confirmed merged" }
  else { TIP = si.tip.trim(); log("wave " + WAVE + " batch " + batch + " integrated: " + si.merged + " branch(es), tip " + TIP + (si.resolved && si.resolved !== "none" ? ", RESOLVED in " + si.resolved : "")) }
}

// Verification is per-step but implementation was per-job: map each step idx to its job's report.
// A crashed/empty/never-dispatched worker reads identically in the verify prompt and the results.
const reportByIdx = {}
jobs.forEach((g, k) => { const r = impls[k] || "(no report returned)"; g.idxs.forEach(idx => { reportByIdx[idx] = r }) })
const implReport = idx => reportByIdx[idx] || "(no report returned)"
log("wave " + WAVE + ": " + steps.length + " step(s) in " + jobs.length + " worker(s)" + (useWorktrees ? " (isolated worktree each)" : " (shared tree, no git)"))

// A non-final batch integrator crashed / hit an unresolvable conflict / returned no valid tip: STOP —
// do not dispatch or verify further. Preserve the results + integration shape so the coordinator's
// stop-on-conflict path still trips (a non-'none' conflict; `failed:true` only on a crashed agent).
if (abort) {
  const at = " — wave aborted at batch " + abort.batch + " (" + abort.reason + ")"
  const results = steps.map(s => {
    const g = jobByIdx[s.idx]
    log("step " + (s.idx + 1) + "/" + TOTAL + " [" + tierOf(g).name + "] (" + s.title + "): unknown" + at)
    return {
      step: s.title, wave: WAVE, tier: tierOf(g).name, worktree: useWorktrees,
      implemented: implReport(s.idx),
      verdict: "unknown", evidence: "",
      problems: (g.batch <= abort.batch ? "implemented but not verified" : "not dispatched") + at,
      integrationConflict: abort.files,
    }
  })
  const integration = {
    merged: mergedSoFar,
    conflict: abort.files || abort.reason,
    resolved: resolvedParts.length ? [...new Set(resolvedParts)].join(", ") : "none",
    squashed: false,
    ...(abort.crash ? { failed: true } : {}),
  }
  log("wave " + WAVE + " ABORTED at batch " + abort.batch + ": " + abort.reason + " (" + mergedSoFar + " branch(es) merged before abort)")
  return { wave: WAVE, results, integration }
}

// ─── Integrate & verify (one Sonnet agent: merge the final batch, then verify the whole wave) ───

const stepBlocks = steps.map(s => {
  const g = jobByIdx[s.idx]
  const mates = g.idxs.filter(i => i !== s.idx)
  const mate = mates.length ? "\n(Built in one worker alongside step(s): " + mates.map(i => i + 1).join(", ") + ")" : ""
  return "### idx " + s.idx + " — " + s.title + "\n" +
    "Intended change: " + s.change + (s.verify ? "\nDone when: " + s.verify : "") +
    (s.files.length ? "\nFiles: " + s.files.join(", ") : "") + mate +
    "\nImplementer reported:\n" + implReport(s.idx)
}).join("\n\n")

// Final-batch split: earlier batches were already integrated by their per-batch integrators (kept
// worktrees), only the final batch's branches remain to merge here.
const priorJobs = jobs.filter(j => j.batch < maxBatch)
const finalJobs = jobs.filter(j => j.batch === maxBatch)

let integratePart
if (!useWorktrees) {
  integratePart = "## Verify\n" +
    "Set `merged` to 0 and `resolved`/`conflict` to 'none' — the step(s) below were edited directly in the current working tree, so there is nothing to merge.\n"
} else if (maxBatch === 1) {
  integratePart = "## Part A — Integrate the wave's worktrees\n" +
    "Each WORKER below ran in its own git worktree under `.claude/worktrees/`, committing its change on its own branch (a worker may cover several bundled steps in one commit). These workers ran in PARALLEL and MAY have edited the SAME file BY DESIGN — a conflict between them is EXPECTED, not a planning error. The worker(s) and the files each touched:\n" +
    jobs.map(jobLine).join("\n") + "\n\n" +
    "Do this from the main working tree (not a worktree):\n" +
    "0. BEFORE anything else, capture the pre-merge HEAD as the squash base: run `git rev-parse HEAD` and RECORD the literal sha it prints (call it START). Do not rely on a shell variable persisting between commands — note the actual sha; you reset onto it verbatim if the wave passes. START, not any passed-in base ref, is the squash base. Then run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER.\n" +
    "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on. Match each branch to a worker by the union of files it touched — you need this mapping in Part B.\n" +
    "2. Integrate them ONE AT A TIME (do NOT create merge commits): for each worktree whose branch is ahead of the working branch, replay it with `git -C <worktree-path> rebase <current-branch>`, then from the main working tree fast-forward with `git merge --ff-only <branch>`.\n" +
    "3. If a rebase reports a CONFLICT, RESOLVE it in place rather than returning to the coordinator: reconcile the two sides so BOTH workers' stated intent — each step's Intended change below — is honoured, never silently dropping one side (parallel jobs may share files by design), then complete the rebase. Add every such file to `resolved`. ONLY if the correct reconciliation is genuinely ambiguous — you would have to guess intent — run `git -C <worktree-path> rebase --abort`, set `conflict` to those files, STOP the merge, and report a BLOCKER; do not guess.\n" +
    "4. Do NOT remove the worktrees yet — Part B needs them to check the merge.\n" +
    "Set `merged` to how many branches you integrated, `resolved` to the files you resolved a conflict in (or 'none'), and `conflict` to any files you could not resolve (or 'none').\n\n" +
    "## Part B — Verify against the integrated tree\n" +
    "(Skip Part B and return `results: []` only if you aborted the merge on an unresolvable conflict in Part A.)\n"
} else {
  const step0 = validSha(START)
    ? "0. The squash base is the sha " + START + " — use it VERBATIM; do NOT record current HEAD (earlier batches were already merged on top of it). Then run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER.\n"
    : "0. No usable squash base exists — do NOT squash; on GREEN set `squashed` false and `summary` 'none'. Then run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER.\n"
  integratePart = "## Part A — Integrate the final batch's worktrees\n" +
    "Batches 1–" + (maxBatch - 1) + " of this wave were ALREADY integrated onto the working branch by per-batch integrators — they are already on the working branch, do NOT re-apply them. Already-integrated worker(s):\n" +
    priorJobs.map(jobLine).join("\n") + "\n" +
    "PENDING — the final batch's worker(s), each still on its own branch in a git worktree under `.claude/worktrees/`; integrate ONLY these now:\n" +
    finalJobs.map(jobLine).join("\n") + "\n\n" +
    "Do this from the main working tree (not a worktree):\n" +
    step0 +
    "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on. Match each PENDING branch to a worker above by the union of files it touched — you need this mapping in Part B (the already-integrated worktrees were kept too, for diffing).\n" +
    "2. Integrate ONLY the PENDING final-batch branches ONE AT A TIME (do NOT create merge commits): for each such worktree whose branch is ahead of the working branch, replay it with `git -C <worktree-path> rebase <current-branch>`, then from the main working tree fast-forward with `git merge --ff-only <branch>`.\n" +
    "3. If a rebase reports a CONFLICT, RESOLVE it in place rather than returning to the coordinator: reconcile the two sides so BOTH workers' stated intent is honoured (parallel jobs MAY share a file BY DESIGN — a conflict here is EXPECTED, not a planning error; reconcile so BOTH jobs' stated intent is honoured, never silently drop one side), then complete the rebase. Add every such file to `resolved`. ONLY if the correct reconciliation is genuinely ambiguous — you would have to guess intent — run `git -C <worktree-path> rebase --abort`, set `conflict` to those files, STOP the merge, and report a BLOCKER; do not guess.\n" +
    "4. Do NOT remove any worktree yet — Part B needs them all to check the merge.\n" +
    "Set `merged` to how many PENDING branches you integrated, `resolved` to the files you resolved a conflict in (or 'none'), and `conflict` to any files you could not resolve (or 'none').\n\n" +
    "## Part B — Verify against the integrated tree\n" +
    "(Skip Part B and return `results: []` only if you aborted the merge on an unresolvable conflict in Part A.)\n"
}

// Part B diff instructions are identical whether one batch or many — every worktree was kept.
const diffInstructions =
  "Use the KEPT worktrees to pinpoint faults the merge itself introduced: for each step, diff the integrated tree against its worker branch (`git diff <worker-branch> -- <that step's files>`); a change dropped or mangled by the rebase/resolution shows up here, located precisely. Scrutinise any file you listed in `resolved` hardest.\n"
const greenBlock = !useWorktrees
  ? ""
  : maxBatch === 1
    ? diffInstructions +
      "AFTER verifying:\n" +
      "- GREEN (EVERY step passed AND no merge-introduced fault): FIRST collapse the whole wave into ONE commit — `git reset --soft <START>` (the sha you recorded in Part A step 0), then a single `git commit -m \"<concise one-line summary of the wave's work>\"` (no attribution trailer; compose the summary from the steps' titles/intent). THEN remove each worktree (`git worktree remove <path>`) and FORCE-delete its branch with `git branch -D <branch>` — the squash rewrote history so the branch tip is no longer an ancestor of HEAD and a plain `git branch -d` will refuse (\"not fully merged\"); the squash intentionally strands the tip and no work is lost. Set `squashed` true and `summary` to that message. (`git reset --soft` only moves the working branch; the worktree branches are untouched, so removing the worktrees is safe.)\n" +
      "  Edge case: if NO worker branch had a commit to merge (`merged` is 0, so the soft reset stages nothing and `git commit` would fail with \"nothing to commit\"), do NOT attempt the squash commit — set `squashed` false and `summary` 'none', and still remove any worktrees.\n" +
      "- NOT GREEN (any step `needs-changes`/`fail`/`blocked`, or a merge fault): do NOT squash — LEAVE the per-step commits AND the worktrees exactly as they are, and name the worktrees you left so the coordinator can inspect them. Set `squashed` false and `summary` 'none'.\n"
    : diffInstructions +
      "AFTER verifying:\n" +
      "- GREEN (EVERY step passed AND no merge-introduced fault): " +
      (validSha(START)
        ? "FIRST collapse the whole wave into ONE commit — `git reset --soft " + START + "` (the squash base named in Part A step 0, used VERBATIM), then a single `git commit -m \"<concise one-line summary of the wave's work>\"` (no attribution trailer; compose the summary from every step's titles/intent); set `squashed` true and `summary` to that message. Edge case: if the soft reset stages nothing (`git commit` fails with \"nothing to commit\"), do NOT force a commit — set `squashed` false and `summary` 'none'. "
        : "do NOT squash — no usable squash base exists; set `squashed` false and `summary` 'none'. ") +
      "THEN clean up ALL of the wave's worktrees (every batch, all listed above): remove each (`git worktree remove <path>`) and FORCE-delete ITS OWN branch with `git branch -D <branch>` — use the branch names from the worktree list in Part A step 1 (`git worktree list`), never a worker's label. A squash rewrote history so a branch tip is no longer an ancestor of HEAD and a plain `git branch -d` will refuse (\"not fully merged\"); the squash intentionally strands the tips and no work is lost. (`git reset --soft` only moves the working branch; the worktree branches are untouched, so removing the worktrees is safe.)\n" +
      "- NOT GREEN (any step `needs-changes`/`fail`/`blocked`, or a merge fault): do NOT squash — LEAVE the commits AND the worktrees exactly as they are, and name the worktrees you left so the coordinator can inspect them. Set `squashed` false and `summary` 'none'.\n"
const greenBarLine = GREEN_BAR
  ? "GREEN additionally requires the project green bar: run " + GREEN_BAR + " and quote the decisive line; any failure means NOT GREEN.\n"
  : ""

phase("Integrate & verify")
const wave = await safeAgent(
  "## Integrate and verify wave " + WAVE + "\n" +
  "This is part of a larger task: " + TASK + "\n\n" +
  integratePart +
  "\nAll the step(s) below are now in the current working tree. Check EACH against its STATED intent, sceptically — and look for interactions BETWEEN them that a per-file review would miss (an assumption that holds in one step but not once another lands). Prefer evidence: run the relevant build/test/lint once if cheap and quote the shortest decisive line.\n" +
  greenBlock +
  greenBarLine +
  "Return a verdict PER STEP, keyed by the given idx. If you genuinely CANNOT determine a step's outcome — you cannot tell what it INTENDED, or the evidence is inconclusive either way — give THAT step the verdict 'blocked' and put your QUESTION/BLOCKER text verbatim in its `problems` (what you checked and exactly what you could not resolve). 'blocked' is a legitimate outcome, never a fabricated pass/fail — and never answer in prose instead of the structured output. An unresolvable MERGE conflict is a different channel: it goes in the top-level `conflict` field, not a step verdict. Any 'blocked' step means the wave is NOT GREEN: do not squash, leave the worktrees.\n\n" +
  stepBlocks + "\n\n" + COMMS,
  { label: "verify:w" + WAVE, phase: "Integrate & verify", model: "sonnet", agentType: NS + "verifier", schema: WAVE_SCHEMA }
)

const verdByIdx = {}
if (wave && Array.isArray(wave.results)) wave.results.forEach(r => { verdByIdx[r.idx] = r })

// A 'blocked' verdict is the verifier's schema-legal ask-back: it could not determine the
// step's outcome and put its QUESTION in that step's problems. The wave is NOT green — the
// verifier was instructed not to squash — and the coordinator escalates to the user.
const blockedIdx = steps.map(s => s.idx).filter(i => verdByIdx[i] && verdByIdx[i].verdict === "blocked")
if (blockedIdx.length) {
  log("wave " + WAVE + " BLOCKED on step idx " + blockedIdx.join(", ") + " — verifier could not determine the outcome; its QUESTION is in each step's problems; worktrees kept, no squash")
  if (wave && wave.squashed) log("wave " + WAVE + " WARNING: verifier reported squashed:true despite a blocked step — inspect before continuing")
}

let integration = null
if (useWorktrees) {
  if (wave && Number.isInteger(wave.merged)) {
    // Union the final verifier's conflict/resolved with any accumulated from earlier batch integrators.
    if (wave.resolved && wave.resolved !== "none") resolvedParts.push(wave.resolved)
    if (wave.conflict && wave.conflict !== "none") conflictParts.push(wave.conflict)
    integration = {
      merged: mergedSoFar + wave.merged,
      conflict: conflictParts.length ? [...new Set(conflictParts)].join(", ") : "none",
      resolved: resolvedParts.length ? [...new Set(resolvedParts)].join(", ") : "none",
      squashed: !!wave.squashed,
      summary: (wave.summary && wave.summary !== "none") ? wave.summary : undefined,
    }
  }
  // Never leave integration null: the wave could not be confirmed merged. A non-'none'
  // conflict here trips the coordinator's stop-on-conflict path via `conflicted`.
  // merged is a floor, not a fact: a crashed verifier may have merged more branches before dying, so this understates the true count. `failed:true` — not the conflict string — is the authoritative crash signal; downstream should key on `failed`, not a conflict-string match.
  if (!integration) integration = { merged: mergedSoFar, conflict: (agentCrash ? "verifier crashed (" + agentCrash + ")" : "verifier returned no result") + " — the wave could not be confirmed merged", resolved: "none", squashed: false, failed: true }
  log("wave " + WAVE + " integrated: " + integration.merged + " branch(es) merged" +
      (integration.resolved && integration.resolved !== "none" ? ", RESOLVED conflicts in: " + integration.resolved : "") +
      (integration.squashed ? ", squashed to 1 commit" + (integration.summary ? ": \"" + integration.summary + "\"" : "") : "") +
      (conflicted(integration) ? ", UNRESOLVED CONFLICT: " + integration.conflict : ""))
}

// Non-git: a crashed/empty verifier must still surface as a wave-level failure rather than
// integration: null — failed:true is the authoritative crash signal here too.
if (!useWorktrees && !wave) integration = { merged: 0, conflict: (agentCrash ? "verifier crashed (" + agentCrash + ")" : "verifier returned no result") + " — the wave could not be confirmed verified", resolved: "none", squashed: false, failed: true }

const conflict = useWorktrees && conflicted(integration) ? integration.conflict : undefined
const results = steps.map(s => {
  const v = verdByIdx[s.idx]
  const g = jobByIdx[s.idx]
  log("step " + (s.idx + 1) + "/" + TOTAL + " [" + tierOf(g).name + "] (" + s.title + "): " + (v ? v.verdict : "unknown"))
  return {
    step: s.title, wave: WAVE, tier: tierOf(g).name, worktree: useWorktrees,
    implemented: implReport(s.idx), verdict: v ? v.verdict : "unknown", evidence: v ? (v.evidence || "") : "", problems: v ? (v.problems || "") : "",
    integrationConflict: conflict,
  }
})

return { wave: WAVE, results, integration }
