# Project guidelines — tiered-development plugin

This repo ships **prompts and agent doctrine**, not a runtime. Almost every file is
read by a model, so the rules below are mostly about keeping what the models read
consistent and unambiguous.

## Language and style

- British spelling in identifiers, comments, prompts and output (`analyse`,
  `serialise`, `behaviour`, `optimisation`).
- Match the surrounding voice: terse, declarative, no filler. Prompt text is written
  for a model to obey, not for a human to enjoy.
- Comments explain **why**, especially for a non-obvious invariant. A comment that
  restates the code earns nothing.

## Prompts and agent doctrine must agree

- An agent's definition (`agents/*.md`) is its system prompt; a workflow's prompt
  string is its task. **They must never contradict each other.** If a workflow starts
  telling an agent to do something its definition forbids, change the definition in
  the same commit — a model given two conflicting instructions does something
  unpredictable, and no test will catch it.
- When behaviour changes, reconcile every place that describes it: `README.md`,
  `skills/tiered-development/SKILL.md`, the affected `agents/*.md`, the workflow's
  own `meta` (description / whenToUse / phases), `CHANGELOG.md`, and
  `.claude-plugin/plugin.json` if the version moves.

## Examples in prompt text

- Before giving an example, ask what the reader must DO with the sentence:
  - **Place a case on a scale the rule cannot operationalise** (tier choice,
    complexity, severity) — examples ARE the rule's content. Keep them, plural,
    spread across the scale, so they read as calibration anchors.
  - **Produce an artefact** (a declaration, a report, a schema field) — give ONE
    example of the output, as a template. A template helps every tier and cannot
    be misread as a category boundary.
  - **Decide whether a case qualifies under a stated test** — no examples of
    qualifying cases: the reader substitutes resemblance for the test. If a
    would-be example carries operational content, it is a rule in disguise —
    promote it and state it as one.
- "These are only examples, not a closed list" is the smell, not the fix. A hedge
  cannot out-anchor a list; needing one means the list should go. A genuinely
  closed list, stated as closed, is fine.
- Fight a model's prior with framing ("any coherent reason qualifies — there is
  no list of approved ones"), never with instances.

## Scream, don't guess

- When an input is malformed or ambiguous, **refuse with a precise diagnostic** naming
  the actual mistake and how to fix it — never guess and continue. Silent wrong
  dispatch is the failure mode this whole pipeline exists to prevent.
- A validation guard must be reachable and its message must describe the real
  condition it guards. Check the condition you mean, next to the thing it protects.
- Ask-backs travel **inside** the structured output (`blocked` verdict, `blocker`
  field, `BLOCKER`/`QUESTION` markers) — never as prose in place of the schema.

## Workflow scripts

- `workflows/*.js` run in a restricted sandbox: plain JavaScript, no TypeScript
  syntax, **no filesystem or Node APIs**, and no `Date.now()` / `Math.random()` /
  argless `new Date()`. Top-level `await` and `return` are available.
- `meta` must be a pure literal — no variables, calls, spreads or interpolation.
- Prefer `pipeline()` over a `parallel()` barrier unless a stage genuinely needs
  every prior result at once.
- A schema-carrying `agent()` throws when the model never produces valid structured
  output. Route those through the file's `safeAgent` wrapper so the failure degrades
  to a returned `{ error }` instead of killing the workflow.

## Verifying a change here

- There is no test suite. Before claiming a workflow change works, at minimum
  parse-check it as an async function body, and exercise any changed pure logic
  (validators, extractors, batch builders) against real inputs including the failure
  cases. Say plainly what you ran.
- Changed prompt text: render the assembled prompt and read it in order. Instruction
  **order** is behaviour — an agent that formats before diffing gets different results
  from one that diffs before formatting.

## Git

- Never add a `Claude-Session:` trailer or any AI-attribution line to a commit
  message. The message ends with the description of the change.
