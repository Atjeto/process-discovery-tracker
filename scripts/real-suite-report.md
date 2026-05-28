# Real-data Test Suite Report

Each test in this report was produced by driving the **real**
capture pipeline (live C# UIA recorder + real foreground apps)
and then running the unmodified `normalize.py` against whatever
the recorder actually wrote. No JSON is synthesised at any step.

| ID | Test | Outcome | Evidence |
|---|---|---|---|
| T01 | Real multi-case onboarding session (3 cases, real httpbin form fills) | **PASS** | cases=3, interactions=37, steps=21, form-field labels seen: True |
| T02 | Real canonical template matches the real-form session | **PASS** | canonical=real-form-onboarding, matched=12/14, canonical_ids hit: ['enter-customer', 'enter-email', 'enter-telephone'], match_rate=0.48 |
| T03b | Real app-vocab enriches the real recorder interactions | **PASS** | vocabs=['outlook', 'real-form-vocab', 'salesforce'], hits={'real-form-vocab': 8}, chrome coverage=61.5% |
| T07 | Real empty session: pipeline produces empty-shape outputs | **PASS** | case_count=1, step_count=0, analysis.json=False, dropped=0 |
| T08 | Real noise-only session: no markers, no steps | **PASS** | case_count=1, step_count=0, interactions=0, activity apps=1 |
| T09 | Real 3-case repeat: step_stats aggregates | **PASS** | step_stats rows=7 (freq>=2 rows=7), step_variants=1 (total freq=2) |
| T05.01 | 10-session agg member sess-01 | **PASS** | case_count=1, interactions=13 |
| T05.02 | 10-session agg member sess-02 | **PASS** | case_count=1, interactions=13 |
| T05.03 | 10-session agg member sess-03 | **PASS** | case_count=2, interactions=25 |
| T05.04 | 10-session agg member sess-04 | **PASS** | case_count=1, interactions=13 |
| T05.05 | 10-session agg member sess-05 | **FAIL** | case_count=1, interactions=1 |
| T05.06 | 10-session agg member sess-06 | **FAIL** | case_count=1, interactions=0 |
| T05.07 | 10-session agg member sess-07 | **PASS** | case_count=1, interactions=13 |
| T05.08 | 10-session agg member sess-08 | **PASS** | case_count=1, interactions=13 |
| T05.09 | 10-session agg member sess-09 | **PASS** | case_count=2, interactions=25 |
| T05.10 | 10-session agg member sess-10 | **PASS** | case_count=1, interactions=13 |
