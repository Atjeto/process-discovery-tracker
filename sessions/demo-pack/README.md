# Demo Pack — PDT 1.0 Polished Engagement

> **Status:** Phase 1 scaffold. Populated by the consultant per
> [PDT-1.0-SPEC §6.4](../../docs/PDT-1.0-SPEC.md#64-demo-pack) and
> [ADR-0033](../../docs/adr/0033-demo-pack.md).

The Demo Pack ships with the installer as a pre-canned polished
Engagement. A prospect opens this and sees an immediate end-to-end
walkthrough — Cockpit, backlog, two finished PDDs, three insight cards —
without having to capture, normalize, or annotate a thing.

## Launch engagement

**Scenario:** *IT Service — Incident handling* (ServiceNow). Picked
because the App Vocabulary for ServiceNow is the strongest in repo
([CHANGELOG §11d](../../CHANGELOG.md)), so the demo's named activities
look most credible.

## Folder shape

```
sessions/demo-pack/
  engagement.json            # the engagement metadata
  sessions/                  # 4 representative sessions (anonymised)
  processes/                 # 2 promoted processes with PDDs
    review-incident/
    reassign-incident/
  deliverables/
    backlog.xlsx
    pdd-bundle.pdf
    insight-cards/
  README.md                  # this file
```

## How it's built

The Demo Pack is **rebuilt every release from real-but-anonymised pilot
data**, not synthesised. The pipeline runs against the source sessions,
PII masking is set aggressively, then the consultant promotes the top 2
candidates and exports deliverables.

The build script (`scripts/build-demo-pack.ps1`) is added in Phase 1.

## Populating

Until the build script lands, populate manually:

1. Capture or copy 4 short ServiceNow sessions into `sessions/`.
2. Normalize each with `viewer/python/python.exe normalization/normalize.py <session> --mine`.
3. Open the engagement in the viewer; promote 2 processes via the Cockpit.
4. Export the backlog (XLSX), PDD bundle (PDF), and 3 insight cards.
5. Verify under Workshop → Analysis that no value-leaks remain.

## Why one engagement, not three

Original spec called for three demos (Finance / IT / HR). One excellent
demo lands harder than three mediocre ones at half the cost. Finance and
HR engagements ship in a later cycle, once the format is validated.
