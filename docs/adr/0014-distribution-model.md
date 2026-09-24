# ADR-0014: Distribution model — GitHub Releases + electron-packager

**Status:** Accepted — implemented (the model has been live since v0.2.0)
**Date:** 2026-05-23 (recorded retroactively; the decision dates to the v0.2.0 pivot)
**Deciders:** Project owner, tracker maintainer

## Context

The product ships **two Electron apps** (capture, viewer) plus a **C# .NET 8
recorder sidecar** and a **bundled Python embeddable** (PM4Py / pandas / networkx).
They must reach **locked-down corporate machines** where, per
[ADR-0001](0001-click-recorder-sidecar-language.md) and the project's binding
constraints, there is **no admin install, no PyPI/npm at runtime, and sec-pass-through
dominates** — anything that looks like an installer or a code-injecting helper risks
an AV/endpoint flag, and IT lockdown blocks MSI/NSIS installers outright.

Early builds kept the packaged output in an in-repo `dist/` folder. That bloats the
repository with binaries, has no clean per-version download story, and risks
committing build slag.

### Forces

- **Sec-pass-through / IT lockdown.** No installer, no admin rights, no per-user MSI.
  A worker or analyst must be able to unzip-and-run.
- **No runtime fetch.** No PyPI, no npm, no auto-update calls at runtime
  ([SECURITY.md](../../SECURITY.md): no network egress).
- **Self-contained artifacts.** The recorder `.exe` and the Python runtime must
  travel *inside* the packaged app — the target machine installs nothing.
- **Two-machine split.** A worker's machine (capture) and an analyst's (viewer) may
  receive the zips by USB / OneDrive if GitHub is unreachable.

## Decision

1. **Prebuilt binaries ship via GitHub Releases, not in git.** The repo carries
   source only; `capture/dist/`, `viewer/dist/`, and the root `dist/` are gitignored.
   A release attaches `capture-vX.Y.Z.zip` and `viewer-vX.Y.Z.zip`.
2. **Package with `electron-packager` (each app's `build-package.js`), NOT
   electron-builder.** electron-builder's winCodeSign cache extraction requires
   Windows **symlink** support (Developer Mode or admin) that the locked-down build
   and target environment can't assume; electron-packager has no such requirement and
   produces a plain unzip-and-run folder.
3. **Artifacts are self-contained.** Capture bundles `recorder.exe` via
   `--extra-resource`; the viewer bundles the Python embeddable + a staged copy of
   `normalization/` the same way. No runtime install on the target machine.
4. **Build + publish via PowerShell scripts.** `scripts/build-distribution.ps1`
   assembles the dist trees and zips; `scripts/publish-release.ps1` wraps
   `gh release create`. Mechanics: [BUILD-AND-DIST.md](../BUILD-AND-DIST.md).

## Options considered

### A — GitHub Releases + electron-packager *(chosen)*
Unzip-and-run folders, versioned downloads off the repo, no installer, no admin.

### B — electron-builder + an NSIS/MSI installer *(rejected)*
A real installer is the conventional path, but: it requires symlink/admin support at
build time (winCodeSign), an installer is exactly the shape corporate AV/SmartScreen
flags, and locked-down machines block installers. Wrong tool for this deployment.

### C — Keep `dist/` in the repo *(rejected)*
Bloats history with ~hundreds of MB of binaries per build, no clean per-tag download,
and invites accidental commits of build slag. GitHub Releases gives versioned
downloads without any of that.

## Consequences

**Easier:**
- Unzip-and-run on a fresh machine — no installer, no admin, no Python/Node install.
- Clean per-tag downloads; USB / OneDrive hand-off when GitHub is unreachable.
- Build outputs stay gitignored, so they never pollute history.

**Harder / to watch:**
- Manual update (download the new zip) — no auto-update channel.
- The `.exe`s ship **unsigned**, so Windows SmartScreen shows "Windows protected your
  PC" on first launch on a fresh machine. A `recorder.zip` auto-extract fallback in
  `recorder.js` guards against a missing unzipped `.exe`.

**Revisit when:**
- An EV code-signing certificate becomes available: fold `signtool` into
  `build-distribution.ps1` so SmartScreen stops prompting (tracked in
  [SPEC-DEFERRED.md](https://github.com/Atjeto/process-discovery-tracker/blob/product-edition/docs/SPEC-DEFERRED.md)
  P2.17, on branch `product-edition`).

## Action items

> All shipped — the model has been live since v0.2.0; this ADR records it.

1. [x] GitHub Releases as the distribution channel; `dist/` gitignored.
2. [x] `electron-packager` via per-app `build-package.js` (off electron-builder).
3. [x] Self-contained artifacts — bundled `recorder.exe` + Python embeddable via `--extra-resource`.
4. [x] `build-distribution.ps1` + `publish-release.ps1` (wraps `gh release create`).
