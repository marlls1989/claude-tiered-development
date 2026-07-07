export const meta = {
  name: "execute-wave",
  description: "Execute ONE wave of an approved plan: a mandatory Sonnet composer groups the wave's steps into worker assignments (bundling cheap related steps, keeping substantive steps solo) and tiers each; each assignment runs in its own git worktree (Opus builder for substantive, Sonnet/Haiku implementer for mechanical/menial); then a single Sonnet integrator/verifier merges the wave's branches back — resolving any conflict in place — verifies every step against the integrated tree, and on a GREEN wave squashes it into one commit. Called once per wave by the tiered-development skill so the coordinator stays in the loop between waves. Worktrees are used whenever in a git repo to keep the coordinator's tree and its LSP diagnostics clean.",
  whenToUse: "Invoked by the tiered-development skill, once per wave. Pass args as an object: { task, wave, steps, isGit, totalSteps?, baseRef? } — steps are this wave's steps (each with idx, title, change, complexity, files, verify). Leave a step's complexity blank to let the composer pick its tier; the composer also groups cheap steps into shared workers. Returns { wave, results, integration }.",
  phases: [
    { title: "Compose", detail: "Mandatory: a Sonnet composer groups the wave's steps into worker assignments (bundling cheap related steps, keeping substantive steps solo) and tiers each group", model: "sonnet" },
    { title: "Implement", detail: "Each worker assignment (a group of steps) runs in its own worktree: Haiku (menial) / Sonnet (mechanical) implementer or Opus builder (substantive)", model: "opus" },
    { title: "Integrate & verify", detail: "A single Sonnet integrator/verifier merges the wave's worktree branches into the working branch, resolving any conflict in place, verifies every step against the integrated tree (diffing against the kept worktrees to pinpoint merge faults), and on a GREEN wave squashes it into one summary commit", model: "sonnet" },
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

// In-wave dependency edges. `dependsOn` is a plan-level DAG over step idx; keep only the refs
// that point at another step IN THIS WAVE. A ref to an earlier wave's step is already built and
// integrated (treated as already satisfied); a self-ref is meaningless. Dedupe as we go.
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

// Scream, don't guess: a cyclic dependsOn among this wave's steps is unbuildable as declared —
// no order satisfies it. design-panel never emits cycles, so this guards hand-authored args
// (same rationale as the duplicate-idx refusal above). Kahn over the in-wave deps; whatever
// cannot be ordered sits on a cycle.
const inDeg = {}
steps.forEach(s => { inDeg[s.idx] = s.deps.length })
const ordReady = steps.filter(s => inDeg[s.idx] === 0).map(s => s.idx)
let ordDone = 0
while (ordReady.length) {
  const cur = ordReady.shift()
  ordDone++
  steps.forEach(s => { if (s.deps.includes(cur) && --inDeg[s.idx] === 0) ordReady.push(s.idx) })
}
if (ordDone < steps.length) {
  const cyc = steps.filter(s => inDeg[s.idx] > 0).map(s => s.idx)
  return { error: "execute-wave: dependency cycle among this wave's steps (idx " + cyc.join(", ") + ") — REFUSING to run this wave; a cyclic dependsOn is unbuildable as declared. Fix the plan's dependsOn and re-invoke." }
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
const GROUPS_SCHEMA = {
  type: "object", required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object", required: ["steps", "complexity"],
        properties: {
          steps: {
            type: "array", items: { type: "integer" },
            description: "idx values of every step in this group, exactly as given; each group = ONE worker/worktree; a group containing a step that depends on a step in ANOTHER group is dispatched only after that group commits and is integrated",
          },
          complexity: { enum: ["menial", "mechanical", "substantive"] },
        },
      },
    },
    rationale: { type: "string", description: "one line on the grouping + tier calls" },
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
          verdict: { enum: ["pass", "needs-changes", "fail"] },
          evidence: { type: "string" },
          problems: { type: "string", description: "concrete problems, most important first, or 'none'" },
        },
      },
    },
  },
}

// ─── Grouping helpers ───
// The unit of implementation is a GROUP: one worker, one worktree, doing every step in it.
// Verification stays per-step (per idx); grouping only changes how work is dispatched.
const TIER_ORDER = { menial: 0, mechanical: 1, substantive: 2 }
const maxTier = (...ts) => { const v = ts.filter(Boolean); return v.length ? v.sort((a, b) => TIER_ORDER[b] - TIER_ORDER[a])[0] : null }
const floorOf = s => (s._cx.status === "ok" ? s._cx.tier : null) // an explicit complexity is a FLOOR, else null (composer decides)
const makeGroup = (members, complexity) => {
  const cx = complexity || "mechanical" // safe middle, matches the old per-step fallback
  // Order members so a merged worker does dependent steps in dependency order; independents and
  // ties fall back to ascending idx (the worker prompt tells it to work 'in order'). Step deps
  // are acyclic (refused earlier), so this always drains — k<0 is unreachable.
  const inGroup = new Set(members.map(m => m.idx))
  const rest = [...members].sort((a, b) => a.idx - b.idx)
  const done = new Set()
  const ordered = []
  while (rest.length) {
    const k = rest.findIndex(m => m.deps.every(d => !inGroup.has(d) || done.has(d)))
    const [next] = rest.splice(k >= 0 ? k : 0, 1)
    ordered.push(next); done.add(next.idx)
  }
  const idxs = ordered.map(m => m.idx)
  const files = [...new Set(ordered.flatMap(m => m.files))]
  const label = (cx === "substantive" ? "build:" : "impl:") + idxs.map(i => i + 1).join("+")
  const title = ordered.length === 1 ? ordered[0].title
    : ordered.length + " steps: " + ordered.map(m => m.title).join("; ")
  ordered.forEach(m => { m.complexity = cx }) // a step's tier is its worker's tier (keeps per-step tierOf/results correct)
  return { members: ordered, idxs, complexity: cx, files, label, title }
}

// The composer PROPOSES a grouping; buildGroups + linkGroups are AUTHORITATIVE. Together they guarantee:
// (1) every idx covered exactly once; (2) no group tiered below a member's floor;
// (3) the group DAG is acyclic and respects step-level deps; (4) file-overlapping groups are ordered.
const buildGroups = picked => {
  const byValue = new Map(steps.map(s => [s.idx, s]))
  const seen = new Set()
  const cleaned = [] // [{ members:[step], pick }]
  const raw = picked && Array.isArray(picked.groups) ? picked.groups : []
  for (const g of raw) {
    const pick = ["menial", "mechanical", "substantive"].includes(g && g.complexity) ? g.complexity : null
    const members = []
    for (const idx of (Array.isArray(g && g.steps) ? g.steps : [])) {
      if (!byValue.has(idx)) { log("compose w" + WAVE + ": group referenced unknown idx " + idx + " — ignored"); continue }
      if (seen.has(idx)) { log("compose w" + WAVE + ": idx " + idx + " duplicated across groups — kept first, dropped dup"); continue }
      seen.add(idx); members.push(byValue.get(idx))
    }
    if (members.length) cleaned.push({ members, pick })
  }
  // Uncovered steps → each its own group at its own floor (the composer dropped them; don't guess a bundle).
  for (const s of steps) if (!seen.has(s.idx)) {
    log("compose w" + WAVE + ": step idx " + s.idx + " uncovered by composer — own group at its floor")
    cleaned.push({ members: [s], pick: floorOf(s) })
  }
  // Floor enforcement (authoritative — never trust the composer to under-tier a step). A
  // substantive member now RAISES its group's tier rather than forcing the group to explode;
  // dispatch coupling is decided by the composer and enforced by linkGroups' derived DAG.
  const out = []
  for (const { members, pick } of cleaned) {
    out.push(makeGroup(members, maxTier(pick, ...members.map(floorOf))))
  }
  return out
}

// linkGroups turns the flat grouping into a DAG: it derives group-level edges from the steps'
// in-wave deps, repairs any cycle the composer's grouping created, adds file-overlap ordering
// edges, then stamps each group with its prerequisite groups (`deps`) and a dispatch `stage`.
// Authoritative for post-conditions (3) and (4). Runs on BOTH the composed and shortcut paths.
const linkGroups = groups => {
  const groupOf = idx => groups.find(g => g.idxs.includes(idx))
  // Group h depends on group g (g!==h) iff a member of h has an in-wave dep on a member of g.
  // Intra-group deps produce no edge (one worker does them in order). Returns h → Set(prereq g).
  const deriveDeps = () => {
    const map = new Map(groups.map(g => [g, new Set()]))
    for (const h of groups)
      for (const m of h.members)
        for (const d of m.deps) {
          const g = groupOf(d)
          if (g && g !== h) map.get(h).add(g)
        }
    return map
  }
  // Find one directed cycle among `nodes` (following prereq edges), so it can be collapsed.
  const findCycle = (nodes, dmap) => {
    const inSet = new Set(nodes), onStack = new Set(), visited = new Set(), stack = []
    let found = null
    const dfs = n => {
      visited.add(n); stack.push(n); onStack.add(n)
      for (const nb of dmap.get(n)) {
        if (found) break
        if (!inSet.has(nb)) continue
        if (onStack.has(nb)) { found = stack.slice(stack.indexOf(nb)); break }
        if (!visited.has(nb)) dfs(nb)
      }
      stack.pop(); onStack.delete(n)
    }
    for (const n of nodes) { if (found) break; if (!visited.has(n)) dfs(n) }
    return found
  }
  // Repair composer-split cycles: Kahn over the group DAG; if it stalls, MERGE one whole cycle
  // into a single worker and re-derive. A group cycle can form even over acyclic step deps (e.g.
  // composer groups {x,z},{y} over x→y→z). Group count strictly drops each merge → terminates.
  let depsMap
  for (;;) {
    depsMap = deriveDeps()
    const indeg = new Map(groups.map(g => [g, depsMap.get(g).size]))
    const queue = groups.filter(g => indeg.get(g) === 0)
    const seen = new Set(queue)
    while (queue.length) {
      const cur = queue.shift()
      for (const h of groups) if (depsMap.get(h).has(cur)) {
        indeg.set(h, indeg.get(h) - 1)
        if (indeg.get(h) === 0 && !seen.has(h)) { seen.add(h); queue.push(h) }
      }
    }
    if (seen.size === groups.length) break
    const cycle = findCycle(groups.filter(g => !seen.has(g)), depsMap)
    const merged = makeGroup(cycle.flatMap(g => g.members), maxTier(...cycle.map(g => g.complexity)))
    log("wave " + WAVE + ": composer grouping formed a cyclic group dependency (" +
        cycle.map(g => g.label).join(" ⇄ ") + ") — MERGED into one worker " + merged.label)
    groups = groups.filter(g => !cycle.includes(g))
    groups.push(merged)
  }
  // Does x transitively depend on y (following the current prereq edges)?
  const dependsPath = (x, y) => {
    const seen = new Set(), stack = [...depsMap.get(x)]
    while (stack.length) {
      const n = stack.pop()
      if (n === y) return true
      if (seen.has(n)) continue
      seen.add(n)
      for (const p of depsMap.get(n)) stack.push(p)
    }
    return false
  }
  // File-overlap ordering: two groups touching the same file must not run concurrently. For each
  // such pair with NO dependency path either way, order the lower-min-idx group first; re-check
  // reachability each time so an added edge can never close a cycle (idxs disjoint → no tie).
  const minIdx = g => Math.min(...g.idxs)
  const ordG = [...groups].sort((a, b) => minIdx(a) - minIdx(b))
  for (let i = 0; i < ordG.length; i++)
    for (let j = i + 1; j < ordG.length; j++) {
      const a = ordG[i], b = ordG[j] // a has the smaller min idx
      const shared = a.files.filter(f => b.files.includes(f))
      if (!shared.length) continue
      if (dependsPath(a, b) || dependsPath(b, a)) continue // already ordered by a dep path
      depsMap.get(b).add(a) // a before b: b depends on a
      log("wave " + WAVE + ": groups " + a.label + " and " + b.label + " share file(s) " +
          shared.join(", ") + " — ordered " + a.label + " before " + b.label)
    }
  // Stamp prerequisite groups and a dispatch stage (1 + max prereq stage; 1 if none).
  for (const g of groups) g.deps = [...depsMap.get(g)]
  const stageOf = new Map()
  const stage = g => {
    if (stageOf.has(g)) return stageOf.get(g)
    const s = g.deps.length ? 1 + Math.max(...g.deps.map(stage)) : 1
    stageOf.set(g, s)
    return s
  }
  for (const g of groups) g.stage = stage(g)
  return groups
}

// ─── Compose: MANDATORY — group the wave's steps into worker assignments AND tier each group.
// Nothing to decide only when there's a single step whose tier is already set: it is its own group.
const needCompose = steps.length > 1 || steps.some(s => s._cx.status === "auto")
let groups
if (!needCompose) {
  groups = linkGroups(steps.map(s => makeGroup([s], floorOf(s))))
} else {
  phase("Compose")
  const picked = await agent(
    "## Group and tier the " + steps.length + " step(s) of wave " + WAVE + "\n" +
    "Part of a larger task: " + TASK + "\n\n" +
    "Decide how to assign these steps to WORKERS. Each worker you define gets ONE git worktree and does every step you put in it. You are only PLANNING the assignment; you do not implement anything.\n\n" +
    "Rules (obey exactly):\n" +
    "- COVER every step's idx EXACTLY ONCE across all groups. Consolidate only — never split a single step across groups.\n" +
    "- Steps may DEPEND on each other (listed per step). You choose the dispatch for coupled steps: MERGE them into ONE worker (it does them in dependency order in one worktree), or CHAIN them as separate workers (a dependent worker is dispatched in a LATER stage, onto the committed, integrated result of every group it depends on). Independent steps go to parallel workers. Bundle cheap related steps to save worktrees.\n" +
    "- Prefer a solo worker for a SUBSTANTIVE step — a clean, focused context is why substantive work goes to its tier — but you MAY merge or chain coupled substantive steps when the coupling warrants it.\n" +
    "- A step's current tier is a FLOOR: never tier a group BELOW any member's stated tier. You may raise a blank/cheap step to a group's tier when you bundle it.\n" +
    SELECTION_PRINCIPLE + "\n\n" +
    "Return `groups`, each { steps:[idx,...], complexity } covering every idx below exactly once.\n\n" +
    steps.map(s => "### idx " + s.idx + " — " + s.title + " [tier: " + (floorOf(s) || "auto") + "]\n" +
      s.change + (s.files.length ? "\nFiles: " + s.files.join(", ") : "") + (s.verify ? "\nDone when: " + s.verify : "") +
      (s.deps.length ? "\nDepends on: idx " + s.deps.join(", ") : "")
    ).join("\n\n") + "\n\n" + COMMS,
    { label: "compose:w" + WAVE, phase: "Compose", model: "sonnet", schema: GROUPS_SCHEMA }
  )
  groups = linkGroups(buildGroups(picked))
  log("wave " + WAVE + " composer grouped " + steps.length + " step(s) into " + groups.length + " worker(s): " +
      groups.map(g => g.label).join(", ") + (picked && picked.rationale ? " — " + picked.rationale : ""))
}
const groupByIdx = {}
groups.forEach(g => g.idxs.forEach(idx => { groupByIdx[idx] = g }))

// ─── Tier routing ───
const TIER = {
  menial: { model: "haiku", agentType: NS + "implementer", name: "haiku" },
  mechanical: { model: "sonnet", agentType: NS + "implementer", name: "sonnet" },
  substantive: { model: "opus", agentType: NS + "builder", name: "opus" },
}
const tierOf = g => TIER[g.complexity] || TIER.mechanical // takes a group (or a step — makeGroup sets each member's complexity)

// ─── Prompts ───
const implOpts = g => {
  const t = tierOf(g)
  const base = { label: g.label, phase: "Implement", model: t.model, agentType: t.agentType }
  return useWorktrees ? { ...base, isolation: "worktree" } : base
}
const implPrompt = g => {
  const judgement = g.complexity === "substantive"
    ? "It needs implementation judgement — decide the 'how' — but do NOT re-open the design or expand scope. If realising it properly would require changing the approach, STOP and report a BLOCKER."
    : "Make exactly these change(s) — no more, and no design judgement. If any is ambiguous or impossible as written, STOP and report a BLOCKER rather than guessing."
  const resetNote = useWorktrees && BASE_REF
    ? "\n\nThis worktree was created by the harness from the repository's DEFAULT branch, which is the WRONG base for this work. BEFORE reading or editing anything, run `git reset --hard " + BASE_REF + "` so your work builds on the intended commit (its objects are already present in the shared repo). If that command fails, or the files/API this work depends on are still missing afterward, STOP and report a BLOCKER rather than guessing."
    : ""
  const wtNote = useWorktrees
    ? resetNote + "\n\nYou are working in an ISOLATED git worktree that may run in parallel with sibling workers. Your worktree may NOT contain in-progress changes from those siblings; if this work turns out to need code another worker was to add and you cannot find it, STOP and report a BLOCKER rather than guessing. When ALL the change(s) below are complete, COMMIT them in this worktree in a SINGLE commit with a concise message describing the work (no attribution trailer)."
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

// ─── Implement ───
phase("Implement")
const impls = await parallel(groups.map(g => () => agent(implPrompt(g), implOpts(g))))
// Verification is per-step but implementation was per-group: map each step idx to its group's report.
// A crashed/empty worker reads identically in the verify prompt and the results.
const reportByIdx = {}
groups.forEach((g, k) => { const r = impls[k] || "(no report returned)"; g.idxs.forEach(idx => { reportByIdx[idx] = r }) })
const implReport = idx => reportByIdx[idx] || "(no report returned)"
log("wave " + WAVE + ": " + steps.length + " step(s) in " + groups.length + " worker(s)" + (useWorktrees ? " (isolated worktree each)" : " (shared tree, no git)"))

// ─── Integrate & verify (one Sonnet agent: merge + resolve, then verify) ───
const conflicted = r => r && r.conflict && r.conflict !== "none"

const stepBlocks = steps.map(s => {
  const g = groupByIdx[s.idx]
  const mates = g.idxs.filter(i => i !== s.idx)
  const mate = mates.length ? "\n(Built in one worker alongside step(s): " + mates.map(i => i + 1).join(", ") + ")" : ""
  return "### idx " + s.idx + " — " + s.title + "\n" +
    "Intended change: " + s.change + (s.verify ? "\nDone when: " + s.verify : "") +
    (s.files.length ? "\nFiles: " + s.files.join(", ") : "") + mate +
    "\nImplementer reported:\n" + implReport(s.idx)
}).join("\n\n")

const integratePart = useWorktrees
  ? "## Part A — Integrate the wave's worktrees\n" +
    "Each WORKER below ran in its own git worktree under `.claude/worktrees/`, committing its change on its own branch (a worker may cover several bundled steps in one commit). The workers were assigned DISJOINT files, so rebasing them onto the working branch should be conflict-free. The worker(s) and the files each touched:\n" +
    groups.map(g => "- " + g.label + " [" + g.members.map(m => m.title).join("; ") + "]" + (g.files.length ? " → " + g.files.join(", ") : " → (unspecified)")).join("\n") + "\n\n" +
    "Do this from the main working tree (not a worktree):\n" +
    "0. BEFORE anything else, capture the pre-merge HEAD as the squash base: run `git rev-parse HEAD` and RECORD the literal sha it prints (call it START). Do not rely on a shell variable persisting between commands — note the actual sha; you reset onto it verbatim if the wave passes. START, not any passed-in base ref, is the squash base. Then run `git status`; if a merge or rebase is already in progress or the tree is dirty, abort/reconcile it (`git merge --abort` / `git rebase --abort`) before starting; if you cannot make it clean, STOP and report a BLOCKER.\n" +
    "1. Run `git worktree list --porcelain` to find the worktrees under `.claude/worktrees/` and the branch each is on. Match each branch to a worker by the union of files it touched — you need this mapping in Part B.\n" +
    "2. Integrate them ONE AT A TIME (do NOT create merge commits): for each worktree whose branch is ahead of the working branch, replay it with `git -C <worktree-path> rebase <current-branch>`, then from the main working tree fast-forward with `git merge --ff-only <branch>`.\n" +
    "3. If a rebase reports a CONFLICT, RESOLVE it in place rather than returning to the coordinator: reconcile the two sides so BOTH workers' stated intent is honoured (a conflict between supposedly file-disjoint workers means their edits overlapped — combine them, never silently drop one side), then complete the rebase. Add every such file to `resolved`. ONLY if the correct reconciliation is genuinely ambiguous — you would have to guess intent — run `git -C <worktree-path> rebase --abort`, set `conflict` to those files, STOP the merge, and report a BLOCKER; do not guess.\n" +
    "4. Do NOT remove the worktrees yet — Part B needs them to check the merge.\n" +
    "Set `merged` to how many branches you integrated, `resolved` to the files you resolved a conflict in (or 'none'), and `conflict` to any files you could not resolve (or 'none').\n\n" +
    "## Part B — Verify against the integrated tree\n" +
    "(Skip Part B and return `results: []` only if you aborted the merge on an unresolvable conflict in Part A.)\n"
  : "## Verify\n" +
    "Set `merged` to 0 and `resolved`/`conflict` to 'none' — the step(s) below were edited directly in the current working tree, so there is nothing to merge.\n"

phase("Integrate & verify")
const wave = await agent(
  "## Integrate and verify wave " + WAVE + "\n" +
  "This is part of a larger task: " + TASK + "\n\n" +
  integratePart +
  "\nAll the step(s) below are now in the current working tree. Check EACH against its STATED intent, sceptically — and look for interactions BETWEEN them that a per-file review would miss (an assumption that holds in one step but not once another lands). Prefer evidence: run the relevant build/test/lint once if cheap and quote the shortest decisive line.\n" +
  (useWorktrees
    ? "Use the KEPT worktrees to pinpoint faults the merge itself introduced: for each step, diff the integrated tree against its worker branch (`git diff <worker-branch> -- <that step's files>`); a change dropped or mangled by the rebase/resolution shows up here, located precisely. Scrutinise any file you listed in `resolved` hardest.\n" +
    "AFTER verifying:\n" +
    "- GREEN (EVERY step passed AND no merge-introduced fault): FIRST collapse the whole wave into ONE commit — `git reset --soft <START>` (the sha you recorded in Part A step 0), then a single `git commit -m \"<concise one-line summary of the wave's work>\"` (no attribution trailer; compose the summary from the steps' titles/intent). THEN remove each worktree (`git worktree remove <path>`) and FORCE-delete its branch with `git branch -D <branch>` — the squash rewrote history so the branch tip is no longer an ancestor of HEAD and a plain `git branch -d` will refuse (\"not fully merged\"); the squash intentionally strands the tip and no work is lost. Set `squashed` true and `summary` to that message. (`git reset --soft` only moves the working branch; the worktree branches are untouched, so removing the worktrees is safe.)\n" +
    "  Edge case: if NO worker branch had a commit to merge (`merged` is 0, so the soft reset stages nothing and `git commit` would fail with \"nothing to commit\"), do NOT attempt the squash commit — set `squashed` false and `summary` 'none', and still remove any worktrees.\n" +
    "- NOT GREEN (any step `needs-changes`/`fail`, or a merge fault): do NOT squash — LEAVE the per-step commits AND the worktrees exactly as they are, and name the worktrees you left so the coordinator can inspect them. Set `squashed` false and `summary` 'none'.\n"
    : "") +
  "Return a verdict PER STEP, keyed by the given idx.\n\n" +
  stepBlocks + "\n\n" + COMMS,
  { label: "verify:w" + WAVE, phase: "Integrate & verify", model: "sonnet", agentType: NS + "verifier", schema: WAVE_SCHEMA }
)

const verdByIdx = {}
if (wave && Array.isArray(wave.results)) wave.results.forEach(r => { verdByIdx[r.idx] = r })

let integration = null
if (useWorktrees) {
  if (wave && Number.isInteger(wave.merged)) {
    integration = {
      merged: wave.merged,
      conflict: (wave.conflict && wave.conflict !== "") ? wave.conflict : "none",
      resolved: (wave.resolved && wave.resolved !== "") ? wave.resolved : "none",
      squashed: !!wave.squashed,
      summary: (wave.summary && wave.summary !== "none") ? wave.summary : undefined,
    }
  }
  // Never leave integration null: the wave could not be confirmed merged. A non-'none'
  // conflict here trips the coordinator's stop-on-conflict path via `conflicted`.
  // merged:0 is a floor, not a fact: a crashed verifier may have merged some branches before dying, so this understates the true count. `failed:true` — not the conflict string — is the authoritative crash signal; downstream should key on `failed`, not a conflict-string match.
  if (!integration) integration = { merged: 0, conflict: "verifier returned no result — the wave could not be confirmed merged", failed: true }
  log("wave " + WAVE + " integrated: " + integration.merged + " branch(es) merged" +
      (integration.resolved && integration.resolved !== "none" ? ", RESOLVED conflicts in: " + integration.resolved : "") +
      (integration.squashed ? ", squashed to 1 commit" + (integration.summary ? ": \"" + integration.summary + "\"" : "") : "") +
      (conflicted(integration) ? ", UNRESOLVED CONFLICT: " + integration.conflict : ""))
}

const conflict = useWorktrees && conflicted(integration) ? integration.conflict : undefined
const results = steps.map(s => {
  const v = verdByIdx[s.idx]
  const g = groupByIdx[s.idx]
  log("step " + (s.idx + 1) + "/" + TOTAL + " [" + tierOf(g).name + "] (" + s.title + "): " + (v ? v.verdict : "unknown"))
  return {
    step: s.title, wave: WAVE, tier: tierOf(g).name, worktree: useWorktrees,
    implemented: implReport(s.idx), verdict: v ? v.verdict : "unknown", evidence: v ? (v.evidence || "") : "", problems: v ? (v.problems || "") : "",
    integrationConflict: conflict,
  }
})

return { wave: WAVE, results, integration }
