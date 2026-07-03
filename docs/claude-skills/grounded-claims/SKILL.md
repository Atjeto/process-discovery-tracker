---
name: grounded-claims
description: Use whenever calling a library, framework, or API method that has not been verified this session, whenever writing imports, method signatures, or configuration keys from memory, whenever editing a file not read in the last few steps, and periodically during any long task. Consult it at task start and whenever about to rely on remembered rather than observed facts.
---

# Grounded claims: the repo outranks your memory

A model's memory of an API, a file, or a value is a probability, not a
fact. Most invented-interface bugs and wrong-target edits come from
acting on remembered state that drifted from reality. The discipline:
observe before relying, and re-observe after acting.

## APIs: read the installed reality

Before calling any method, signature, or option not verified this
session:

1. Check the version actually installed: the lockfile or the package
   metadata, not the version remembered from training. The API in
   memory may belong to a different major version.
2. Read the real signature: the installed source (node_modules,
   site-packages) or the type definitions. Thirty seconds of reading
   beats a plausible guess that costs a debugging cycle.
3. When documentation and installed code disagree, the installed code
   wins; it is what will execute.

Never invent: a method name, a parameter, a config key, an import path,
or a CLI flag. If it cannot be verified quickly, say so and use the
verified alternative, or flag the uncertainty in the report.

## Files: re-read before editing

The file on disk outranks the memory of the file. Re-read the relevant
region immediately before editing it; after any successful edit, every
earlier mental snapshot of that file is stale. Locate edit targets by
QUOTED strings, not line numbers; line numbers drift, strings survive.

## Values: grep beats recall, every time

DOM handles, selectors, route names, env keys, script names: grep the
current value from the source of truth before using it. Documented
case: remembered nav handles were wrong, the wrongness was even written
into a guidance doc, and the guessed values silently skipped two whole
verification surfaces. When recall and a grep disagree, the grep wins
without exception, and the doc that agreed with recall gets corrected.

## The instrument is part of the system

Your reads and probes are observations made THROUGH machinery, and the
machinery can lie. Documented cases: this harness's %APPDATA% reads
are MSIX-virtualized to a stale shadow that once read "empty" against
a real file holding 86 hours of data (windows-environment); jsdom
cannot reproduce some React scheduling warnings; a clipping probe was
blind to text-overflow ellipsis by construction. So when your
observation contradicts the owner's account of reality, or two of your
own instruments disagree, suspect the instrument before the world.
Corroborate through a second channel (a different tool, a copy of the
file in a non-virtualized location, the owner's own eyes) before
concluding that data is lost or code is broken.

## The re-anchor protocol (long-context decay)

Compliance with instructions decays silently as context grows; the
model does not feel itself forgetting. Countermeasure, mechanical and
cheap:

- After completing each item, and again before writing the final
  report: re-read the task's fences (what is forbidden) and its mission
  anchor or scope statement (what the whole task is).
- If the current activity is not clearly serving the re-read mission,
  stop the activity, not the re-reading.

This costs under a minute per task and eliminates the largest silent
failure mode of long sessions.

## Spoken uncertainty

Anything not checked is labeled: "unchecked", "from memory", "assumed
from the brief". Fluent prose must never launder a guess into a fact;
the reviewer allocates attention based on those labels (see
verified-completion for the full claim-status vocabulary).
