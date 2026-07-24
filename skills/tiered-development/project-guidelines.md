# Project guidelines

Standing rules for a project, kept in one file so the coordinator never has to
restate them to each worker.

## Where it lives

`GUIDELINES.md`, at the root of the project being worked on — a normal, committed
file, versioned and reviewed like any other project decision. It persists between
sessions; that is the point.

Committing it also keeps it honest if anyone opens it directly: worktrees contain
only *tracked* files, so an uncommitted guidelines file would be invisible from
inside one.

## How it reaches the workers

The coordinator reads the file once at step 0 and passes its contents verbatim as
the `guidelines` argument to `design-panel`, `execute-wave` and `review-panel`.
Each workflow injects them under a **Project guidelines** heading into every agent
that designs, writes or judges code — architects, builders, implementers, integrators,
reviewers. The composers, which only choose models and batch shapes, do not get them.

Nothing is summarised on the way: an agent sees the rules exactly as written.
This matters, because the whole point is that the coordinator is not in the loop
re-deriving which rules apply to which task.

## Precedence

A guideline is a hard requirement, and no agent may decide to break one. If a task
cannot be carried out without violating a guideline, the agent STOPS and reports a
`BLOCKER` naming the guideline, the exact conflict, why it sees no compliant route,
and what it would do if authorised. It does not implement a violating version and
explain afterwards.

Only the **user** authorises a violation; the coordinator escalates and relays the
answer. A violation is a last resort with a stated justification, not a judgement
call at the bottom of the chain. If the same guideline keeps blocking real work, the
guideline is wrong — fix the file rather than routinely overriding it.

## What belongs in it

Rules that hold for **every** task in the project:

- Global requirements — licensing headers, supported runtimes, API compatibility
  promises, security or privacy constraints.
- Conventions a fresh agent cannot infer quickly or reliably from the code — naming,
  spelling (e.g. British spelling in identifiers), error-handling style, logging,
  comment density, commit-message rules.
- Practices that must hold — test-first, no new dependencies without asking, public
  API changes need a changelog entry, never widen a type to silence a checker.
- Traps specific to the repo — a generated file that must not be hand-edited, a
  module whose ordering is load-bearing, a check that is expected to be red.

## What does not

- Anything that applies only to the current task — that goes in the step's own
  instructions, where it belongs.
- Anything a worker can read off the code in seconds. Guidelines are prepended to
  every prompt in the run; each line costs tokens on every agent, so earn the line.
- The project's green bar — that is `greenBar`, which the wave gates on directly.
- Restating the comms protocol or the ask-back rule. Every agent already has both.

## Format

Plain markdown, short imperative bullets, grouped under headings. Say the rule and,
where it is not obvious, why — a rule an agent understands is one it can apply to a
case you did not foresee. Keep it to something a person will actually maintain; a
file nobody prunes becomes a file nobody follows.

```markdown
# Project guidelines

## Language and style
- British spelling in identifiers, comments and user-facing output (`analyse`,
  `serialise`, `behaviour`).

## Testing
- Tests before implementation. A bug fix starts with a test that reproduces it.

## Dependencies
- No new runtime dependency without asking — this ships to air-gapped installs.
```
