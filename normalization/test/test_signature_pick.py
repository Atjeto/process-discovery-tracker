"""Ground-truth test for the ADR-0025 volatility-diff signature picker.

THE KILLER TEST (the P2 done-criterion): point the auto-picker at two-pass
window snapshots and assert it reproduces the *hand-probed* signatures committed
under ``normalization/app_vocabularies/`` — most importantly that it **demotes**
Salesforce's per-render ``input-378`` to the stable ``"Account Name"`` label,
exactly as the analyst did by hand in the real-value cycle.

These are validated against the committed vocabs (the regression fixtures): a
stable semantic id (Excel ``FileSave``, ServiceNow ``incident.short_description``,
Outlook ``4117``, Jira ``summary-field``) must be KEPT, while a documented-volatile
auto-id (Salesforce / Zendesk) must be DEMOTED to its accessible label.

Pure-Python (PyYAML only) so it runs on a bare interpreter.

Run with:
    pytest normalization/test/test_signature_pick.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

NORM_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(NORM_DIR))

import signature_pick  # noqa: E402
import app_vocab        # noqa: E402

VOCAB_DIR = NORM_DIR / "app_vocabularies"


# --- Helpers -----------------------------------------------------------

def ctrl(pass_, *, control_type=None, automation_id=None, name=None,
         class_name=None, framework="chromium", bounds=None, depth=1):
    """One synthetic snapshot_control line (the shape the recorder emits)."""
    d = {
        "pass": pass_, "depth": depth,
        "control_type": control_type, "automation_id": automation_id,
        "name": name, "class_name": class_name, "framework": framework,
        "role": (control_type or "").lower() or None,
    }
    if bounds:
        d["bounds"] = bounds
    return d


def pick_one(*controls):
    """Join + pick for a single logical control given its per-pass snapshots."""
    return signature_pick.pick_signature(signature_pick.join_passes(list(controls))[0])


def load_vocab(vocab_id):
    with open(VOCAB_DIR / f"{vocab_id}.yaml", encoding="utf-8") as fh:
        return yaml.safe_load(fh)["app_vocabulary"]


# === The killer cases (explicit, realistic two-pass inputs) ============

def test_excel_filesave_keeps_stable_idmso():
    """Office idMso is stable across renders + matches no volatility pattern."""
    pick = pick_one(
        ctrl(1, control_type="Button", automation_id="FileSave", name="Save",
             class_name="NetUIRibbonButton", framework="win32"),
        ctrl(2, control_type="Button", automation_id="FileSave", name="Save",
             class_name="NetUIRibbonButton", framework="win32"),
    )
    assert pick["signature"] == {"control_type": "Button", "automation_id": "FileSave"}
    assert pick["identity_source"] == "automation_id"
    assert pick["volatile_aids"] == []


def test_servicenow_keeps_stable_dom_id():
    """ServiceNow exposes a stable element id as the automation_id."""
    pick = pick_one(
        ctrl(1, control_type="Edit", automation_id="incident.short_description",
             name="Short description"),
        ctrl(2, control_type="Edit", automation_id="incident.short_description",
             name="Short description"),
    )
    assert pick["signature"] == {"control_type": "Edit",
                                 "automation_id": "incident.short_description"}
    assert pick["identity_source"] == "automation_id"


def test_salesforce_demotes_volatile_input_id_to_label():
    """THE crux: Salesforce Lightning regenerates input-378 -> input-411 across
    renders. The two-pass diff catches it; the picker demotes to the label."""
    pick = pick_one(
        ctrl(1, control_type="Edit", automation_id="input-378", name="Account Name",
             class_name="slds-input", bounds={"x": 100, "y": 200, "w": 240, "h": 32}),
        ctrl(2, control_type="Edit", automation_id="input-411", name="Account Name",
             class_name="slds-input", bounds={"x": 100, "y": 200, "w": 240, "h": 32}),
    )
    assert pick["signature"] == {"control_type": "Edit", "name": "Account Name"}
    assert pick["identity_source"] == "name"
    assert pick["volatile_aids"] == ["input-378", "input-411"]


def test_salesforce_demotes_on_pattern_even_single_pass():
    """Even without a second pass, ^input-\\d+$ alone flags the id volatile."""
    pick = pick_one(
        ctrl(1, control_type="Edit", automation_id="input-378", name="Account Name",
             class_name="slds-input"),
    )
    assert pick["signature"] == {"control_type": "Edit", "name": "Account Name"}
    assert "input-378" in pick["volatile_aids"]


def test_outlook_keeps_classic_command_id():
    """Classic Outlook's command-id (To=4117) is a stable numeric id."""
    pick = pick_one(
        ctrl(1, control_type="Edit", automation_id="4117", name="To",
             class_name="RichEdit20WPT", framework="win32"),
        ctrl(2, control_type="Edit", automation_id="4117", name="To",
             class_name="RichEdit20WPT", framework="win32"),
    )
    assert pick["signature"] == {"control_type": "Edit", "automation_id": "4117"}


def test_jira_keeps_semantic_field_id_but_zendesk_volatile():
    """Jira's <field>-field id is stable; Zendesk's combobox auto-id is volatile."""
    jira = pick_one(
        ctrl(1, control_type="Edit", automation_id="summary-field", name="Summary"),
        ctrl(2, control_type="Edit", automation_id="summary-field", name="Summary"),
    )
    assert jira["signature"] == {"control_type": "Edit", "automation_id": "summary-field"}

    zendesk = pick_one(
        ctrl(1, control_type="ComboBox", automation_id="downshift-3-input",
             name="Requester", bounds={"x": 50, "y": 80, "w": 200, "h": 28}),
        ctrl(2, control_type="ComboBox", automation_id="downshift-12-input",
             name="Requester", bounds={"x": 50, "y": 80, "w": 200, "h": 28}),
    )
    assert zendesk["signature"] == {"control_type": "ComboBox", "name": "Requester"}
    assert zendesk["volatile_aids"] == ["downshift-12-input", "downshift-3-input"]


# === Drive from the committed ground-truth vocabs ======================

# Apps whose committed signatures key on a STABLE automation_id: the picker must
# KEEP every such id (never spuriously flag a stable semantic id as volatile).
_STABLE_AID_VOCABS = ["excel", "outlook", "word", "servicenow", "jira"]

# Apps the real-value cycle documented as having EVERY automation_id auto-
# generated / per-load volatile: a name-keyed signature must be reproduced by
# demoting a (synthesized) volatile aid to the label.
_VOLATILE_AID_VOCABS = ["salesforce", "zendesk"]


@pytest.mark.parametrize("vocab_id", _STABLE_AID_VOCABS)
def test_stable_aids_are_reproduced_from_ground_truth(vocab_id):
    """For every committed aid-keyed entry, the picker keeps that exact id."""
    vocab = load_vocab(vocab_id)
    failures = []
    checked = 0
    for entry in vocab.get("interactions") or []:
        sig = entry.get("signature") or {}
        aid = sig.get("automation_id")
        if not aid:
            continue  # name/class-keyed entries are a human generalization call
        checked += 1
        ct = sig.get("control_type")
        # Synthesize the snapshot this control would produce: a stable aid in
        # both passes, with a plausible label.
        label = entry.get("name") or "Label"
        pick = pick_one(
            ctrl(1, control_type=ct, automation_id=aid, name=label),
            ctrl(2, control_type=ct, automation_id=aid, name=label),
        )
        expected = {"automation_id": aid}
        if ct:
            expected["control_type"] = ct
        if pick["signature"] != expected or pick["identity_source"] != "automation_id":
            failures.append(f"{aid}: picked {pick['signature']} ({pick['identity_source']})")
    assert checked > 0, f"{vocab_id}: no aid-keyed entries to check"
    assert not failures, f"{vocab_id} stable-id regressions:\n  " + "\n  ".join(failures)


@pytest.mark.parametrize("vocab_id", _VOLATILE_AID_VOCABS)
def test_volatile_aid_apps_demote_to_label_from_ground_truth(vocab_id):
    """For every committed name-keyed entry in a documented all-volatile app, a
    synthesized per-render aid is demoted to reproduce the label signature."""
    vocab = load_vocab(vocab_id)
    failures = []
    checked = 0
    for i, entry in enumerate(vocab.get("interactions") or []):
        sig = entry.get("signature") or {}
        name = sig.get("name")
        ct = sig.get("control_type")
        if not name or sig.get("automation_id"):
            continue
        checked += 1
        # The real app auto-generates the id and renumbers it per load -> the
        # two passes see different ids for the same (label-joined) control.
        pick = pick_one(
            ctrl(1, control_type=ct, automation_id=f"input-{300 + i}", name=name,
                 bounds={"x": 10, "y": 10 + i, "w": 100, "h": 20}),
            ctrl(2, control_type=ct, automation_id=f"input-{700 + i}", name=name,
                 bounds={"x": 10, "y": 10 + i, "w": 100, "h": 20}),
        )
        expected = {"name": name}
        if ct:
            expected["control_type"] = ct
        if pick["signature"] != expected or pick["identity_source"] != "name" \
                or not pick["volatile_aids"]:
            failures.append(f"{name!r}: picked {pick['signature']} "
                            f"(vol={pick['volatile_aids']})")
    assert checked > 0, f"{vocab_id}: no name-keyed entries to check"
    assert not failures, f"{vocab_id} demotion regressions:\n  " + "\n  ".join(failures)


# === bootstrap_from_snapshot ===========================================

def test_bootstrap_from_snapshot_builds_named_skeleton():
    """The skeleton pre-fills names from labels, groups by window title, dedups
    by picked signature, and carries the picked identity/confidence/volatility."""
    controls = [
        # A stable Office button (kept as aid).
        ctrl(1, control_type="Button", automation_id="FileSave", name="Save",
             framework="win32"),
        ctrl(2, control_type="Button", automation_id="FileSave", name="Save",
             framework="win32"),
        # A volatile Salesforce field (demoted to label).
        ctrl(1, control_type="Edit", automation_id="input-378", name="Account Name",
             bounds={"x": 1, "y": 1, "w": 9, "h": 9}),
        ctrl(2, control_type="Edit", automation_id="input-411", name="Account Name",
             bounds={"x": 1, "y": 1, "w": 9, "h": 9}),
    ]
    doc = app_vocab.bootstrap_from_snapshot(
        controls, window_title="Acme - Salesforce",
        vocab_id="sf", vocab_name="Salesforce")
    v = doc["app_vocabulary"]
    assert v["id"] == "sf"
    assert v["screens"][0]["name"] == "Acme - Salesforce"
    assert v["scope"]["window_title_regex"] == r".*Acme\ \-\ Salesforce.*"

    by_label = {i["name"]: i for i in v["interactions"]}
    assert by_label["Save"]["signature"] == {"control_type": "Button",
                                             "automation_id": "FileSave"}
    assert by_label["Save"]["identity_source"] == "automation_id"
    acct = by_label["Account Name"]
    assert acct["signature"] == {"control_type": "Edit", "name": "Account Name"}
    assert acct["volatile_aids"] == ["input-378", "input-411"]
    # Every entry carries a screen and a confidence (the legend the picker shows).
    assert all("screen" in i and "confidence" in i for i in v["interactions"])


def test_discover_vocab_entry_wraps_bootstrap():
    """The discover_vocab CLI entry point produces the same skeleton doc."""
    import discover_vocab
    doc = discover_vocab.discover({
        "controls": [
            ctrl(1, control_type="Button", automation_id="FileSave", name="Save"),
            ctrl(2, control_type="Button", automation_id="FileSave", name="Save"),
        ],
        "window_title": "Book1 - Excel",
        "vocab_id": "excel", "vocab_name": "Microsoft Excel",
    })
    v = doc["app_vocabulary"]
    assert v["id"] == "excel"
    assert v["interactions"][0]["signature"] == {"control_type": "Button",
                                                 "automation_id": "FileSave"}


def test_bootstrap_from_snapshot_dedups_repeated_controls():
    """One control across two passes joins to a single entry; two DISTINCT
    controls that pick the same signature collapse with seen_count incremented."""
    # A single control seen in both passes -> one joined group -> one entry.
    one = app_vocab.bootstrap_from_snapshot([
        ctrl(1, control_type="Button", automation_id="FileSave", name="Save"),
        ctrl(2, control_type="Button", automation_id="FileSave", name="Save"),
    ], window_title="Book1 - Excel")["app_vocabulary"]["interactions"]
    assert len(one) == 1
    assert one[0]["seen_count"] == 1

    # Two distinct buttons (different positions) both demote to the same
    # {Button, name:"Submit"} signature -> deduped, seen_count == 2.
    two = app_vocab.bootstrap_from_snapshot([
        ctrl(1, control_type="Button", automation_id="input-12", name="Submit",
             bounds={"x": 0, "y": 0, "w": 50, "h": 20}),
        ctrl(1, control_type="Button", automation_id="input-34", name="Submit",
             bounds={"x": 0, "y": 500, "w": 50, "h": 20}),
    ], window_title="Acme - Salesforce")["app_vocabulary"]["interactions"]
    assert len(two) == 1
    assert two[0]["signature"] == {"control_type": "Button", "name": "Submit"}
    assert two[0]["seen_count"] == 2


# === ADR-0025 annotator-context enrichment =============================

def test_pick_all_attaches_ancestry():
    """pick_all surfaces each control's ancestry (parent control_types, outermost
    first) so the annotator sees where a control lives in the tree."""
    controls = [
        ctrl(1, control_type="Window", name="App", depth=0),
        ctrl(1, control_type="Pane", depth=1),
        ctrl(1, control_type="Toolbar", depth=2),
        ctrl(1, control_type="Button", automation_id="Save", name="Save", depth=3,
             bounds={"x": 5, "y": 5, "w": 30, "h": 20}),
    ]
    picks = signature_pick.pick_all(controls)
    save = next(p for p in picks if p["group"][0].get("name") == "Save")
    assert save["ancestry"] == ["Window", "Pane", "Toolbar"]


def test_bootstrap_enriches_annotator_context():
    """Each entry carries role / framework / on-screen region for the editor
    legend -- the context that makes a bare signature legible."""
    controls = [
        ctrl(1, control_type="Edit", automation_id="incident.short_description",
             name="Short description", framework="uia",
             bounds={"x": 100, "y": 50, "w": 200, "h": 24}),
        ctrl(2, control_type="Edit", automation_id="incident.short_description",
             name="Short description", framework="uia",
             bounds={"x": 100, "y": 50, "w": 200, "h": 24}),
    ]
    e = app_vocab.bootstrap_from_snapshot(
        controls, window_title="X")["app_vocabulary"]["interactions"][0]
    assert e["role"] == "edit"          # ctrl() derives role from control_type
    assert e["framework"] == "uia"
    assert isinstance(e.get("region"), str) and e["region"]


def test_bootstrap_flags_overmerged_classname_controls():
    """A generic class_name with no label collapses genuinely DISTINCT controls;
    the skeleton keeps each merged member's context (role/region) so the annotator
    can tell them apart and split a wrong bucket -- the Spotify-in-Chrome failure
    that made one '×5' row hide five different controls."""
    controls = [
        # Two DIFFERENT controls (top-left vs bottom-right), same generic class,
        # neither with a name -> both key on {class_name} and collapse to one row.
        ctrl(1, control_type="Button", class_name="x-btn",
             bounds={"x": 0, "y": 0, "w": 40, "h": 20}),
        ctrl(2, control_type="Button", class_name="x-btn",
             bounds={"x": 0, "y": 0, "w": 40, "h": 20}),
        ctrl(1, control_type="Button", class_name="x-btn",
             bounds={"x": 900, "y": 700, "w": 40, "h": 20}),
        ctrl(2, control_type="Button", class_name="x-btn",
             bounds={"x": 900, "y": 700, "w": 40, "h": 20}),
    ]
    v = app_vocab.bootstrap_from_snapshot(
        controls, window_title="App")["app_vocabulary"]
    assert len(v["interactions"]) == 1
    e = v["interactions"][0]
    assert e["signature"] == {"class_name": "x-btn"}
    assert e["identity_source"] == "class_name"
    assert e["seen_count"] == 2
    assert len(e.get("_members", [])) == 2
    # The two merged controls are at distinct on-screen regions -> visibly NOT
    # the same thing.
    assert len({m.get("region") for m in e["_members"]}) == 2


def test_bootstrap_named_dedup_has_no_overmerge_noise():
    """A shared LABEL is a legitimate single interaction (two 'Submit' buttons are
    one vocab entry) -- no over-merge member list in that case."""
    v = app_vocab.bootstrap_from_snapshot([
        ctrl(1, control_type="Button", automation_id="input-12", name="Submit",
             bounds={"x": 0, "y": 0, "w": 50, "h": 20}),
        ctrl(1, control_type="Button", automation_id="input-34", name="Submit",
             bounds={"x": 0, "y": 500, "w": 50, "h": 20}),
    ], window_title="Acme - Salesforce")["app_vocabulary"]["interactions"]
    assert len(v) == 1 and v[0]["seen_count"] == 2
    assert "_members" not in v[0]


def test_discover_vocab_decodes_stdin_as_utf8(monkeypatch, capsys):
    """The viewer pipes controls to stdin as UTF-8. discover_vocab must decode
    UTF-8 explicitly -- Python defaults stdin to the locale codepage on Windows
    (cp1252), which mangled emoji / '•' control names into mojibake ('â€¢').
    Simulate that hostile locale by wrapping stdin as cp1252: the fix reads the
    raw byte buffer, so the emoji must survive."""
    import io
    import sys as _sys
    import json as _json
    import discover_vocab
    payload = {
        "controls": [
            {"pass": 1, "control_type": "Text", "name": "🏰 Mythic+", "framework": "chromium"},
            {"pass": 2, "control_type": "Text", "name": "🏰 Mythic+", "framework": "chromium"},
        ],
        "window_title": "Discord", "vocab_id": "d", "vocab_name": "Discord",
    }
    raw = _json.dumps(payload).encode("utf-8")     # exactly what the viewer writes
    # cp1252-wrapped stream whose .buffer still yields the raw UTF-8 bytes.
    monkeypatch.setattr(_sys, "stdin", io.TextIOWrapper(io.BytesIO(raw), encoding="cp1252"))
    rc = discover_vocab.main([])
    assert rc == 0
    out = capsys.readouterr().out.strip().splitlines()[-1]
    doc = _json.loads(out)
    names = [i.get("name") for i in doc["app_vocabulary"]["interactions"]]
    assert "🏰 Mythic+" in names, names
    assert not any("â€¢" in (n or "") or "Ã" in (n or "") for n in names), names
