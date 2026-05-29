# Build-box / packaged-app validation queue

Tasks that **cannot be completed or verified on a plain dev box** — they change
the shipped artifact (bundled Python, packaged Electron) or need a real capture/
OBS run. Do these on the build environment with the full toolchain, then validate
the **packaged** app (it bundles its own Python), per CLAUDE.md.

Created 2026-05-29 alongside the fix-first-queue + dependency-block work
(branch `fix/fix-first-queue-2026-05`).

---

## 1. TD#17 — bundle a maintained Python + add a lockfile

**Why deferred:** `scripts/build-python-embeddable.ps1` pins `3.11.9`. Python 3.11
went security-only (source-only) after 3.11.9 — **no Windows embeddable exists past
3.11.9** (verified: `python-3.11.13-embed-amd64.zip` → 404). So the patch can't be
bumped; the runtime must move to 3.12.x or 3.13.x (both embeddables confirmed: 200).
Building the ~450 MB embeddable and running the pipeline against it is not possible
on a dev box without the heavy deps (pm4py/pandas/networkx/python-docx).

**Steps:**
1. Pick the target Python:
   - **3.12.x** — matches CONTRIBUTING's documented dev Python (parity); shorter
     security runway.
   - **3.13.x** — longer patch runway; requires also updating CONTRIBUTING's dev
     version to keep dev/bundle parity.
2. Set `$PythonVersion` in `scripts/build-python-embeddable.ps1` to the chosen
   latest patch.
3. Rebuild the embeddable: `.\scripts\build-python-embeddable.ps1 -Force`.
4. Capture a resolved lockfile: `python -m pip freeze` inside the bundle →
   `normalization/requirements.lock`; decide whether the build script installs from
   the lock (reproducible) or keeps the floored `requirements.txt` (from-scratch).
5. Run the **full** pipeline on the bundle: `viewer/python/python.exe
   normalization/normalize.py sessions/example-aggregate/... --mine` and
   `python -m pytest normalization/test/` against the bundled interpreter.
6. Validate the packaged viewer end-to-end (analyze a session, export PDD).

## 2. Electron 42 — packaged-build validation

**Why deferred:** the Electron 33→42 bump (commit `30bbe39`) is verified in dev
(unit suites green, app boots/renders via the Playwright harness, 0 page errors),
but the **packaged** build was not produced here (bundled `viewer/python/` is
gitignored, ~450 MB).

**Steps:**
1. `.\scripts\build-distribution.ps1 -SkipPython` (or full) for both apps under
   Electron 42 (`@electron/packager`, now that `electron-builder` is removed).
2. Launch the packaged viewer + capture `.exe` on the locked-down work laptop.
3. Confirm: session loads, maps render (BPMN + DFG), video sync, OBS connect,
   the C# recorder sidecar spawns, PDD export. Watch for Chromium-42 behavior diffs.

## 3. GUI-only behavior checks (real run / harness)

Fixed in code + unit-tested at the seam level, but the end-to-end UI interaction
was reasoned through, not driven. Confirm in the running app (or extend
`_pdt_verify`):
- **Marker rename → undo** (H-5): rename a marker, Ctrl+Z reverts it; then make a
  second unrelated edit and Ctrl+Z reverts only that edit (no double-revert).
- **Phase membership** (M-1..M-4): delete a step in a phase → count decrements,
  gone from phase list + map, Ctrl+Z restores; split → both halves in phase;
  merge where only one half was in a phase → survivor lands in it; re-analyze after
  deleting a step in an edited phase → count reflects the regenerated set.
- **Idle auto-end once** (H-7): over a real idle stretch (PDT_DEBUG=1), `boot.log`
  shows a single `auto_end_idle`, not one every 5 s.
- **Vocab `seen_count`** (H-3): save an App-Library vocab, reopen → `seen N×`
  ranking badges survive.
- **OBS status logging / no-tray guard** (TD#1b, M-20): real OBS failing
  `StopRecord`; a permission-denied engagement folder still lets the tray launch.
