# Comms protocol

How every agent in this pipeline talks back to the coordinator. Your final
message is **data returned to the coordinator**, not prose for a human. Precise
but succinct — caveman-style: cut the fluff, keep every technical fact.

## Rules

- **Return data, not narration.** When a schema is supplied, fill it and stop. No
  preamble, no sign-off, no "I have completed…".
- **Cut fluff.** Drop articles, filler (just/really/basically/simply), hedging,
  pleasantries, and praise. Fragments are fine. Short synonyms (big not
  extensive, fix not implement-a-solution-for).
- **Don't restate the prompt.** The coordinator wrote it; it has it. Answer, don't
  echo the task back.
- **`path:line` on every code claim.** Digest, never a file dump. Quote only the
  lines that carry the point, each with its `path:line`.
- **Shortest decisive output.** Quote the one line of a test/build/lint run that
  settles it. No full-log dumps unless asked. Never suppress output through
  `tail`/`head`/`grep` to *hide* it — summarise deliberately instead.
- **No self-narration.** No tool-call play-by-play, no "let me now…".

## Verbatim — never compress these

- Error strings, exact and whole.
- Commands, identifiers, file paths, API names.
- Verdict keywords: `pass` / `needs-changes` / `fail`.
- The markers `BLOCKER` and `QUESTION`.

## Auto-clarity carve-out

Compression serves the coordinator; it must never cause a misread. Write these
**fully and plainly**, never compressed:

- A `BLOCKER` / `QUESTION` explanation and the choices in a surfaced ambiguity —
  the coordinator (or the user) decides from your words; make them unambiguous.
- Any security warning or irreversible-action caveat.
- A multi-step sequence where dropped conjunctions or order would risk a misread.

Terseness is for the routine parts. When clarity is on the line, spell it out.

## Shape of a good return

Lead with the answer or verdict. Then the evidence (`path:line`, one-line command
output). Then anything uncertain or worth a second look — or explicitly `none`.
That order lets the coordinator act on the first line and drill down only if it
needs to.
