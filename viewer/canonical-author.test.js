/*
 * Unit tests for canonical-author.js -- the Process Template authoring
 * helpers: match-rule derivation and session-steps -> template-steps.
 *
 * Run with `npm test` (Node's built-in `node:test` runner).
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const CA = require("./canonical-author.js");

function interaction(id, data) {
  return { event_id: id, type: "interaction", timestamp: id, data };
}

test("slugify lowercases and hyphenates", () => {
  assert.equal(CA.slugify("Customer Onboarding"), "customer-onboarding");
  assert.equal(CA.slugify("  KYC / Verify!! "), "kyc-verify");
  assert.equal(CA.slugify(""), "");
});

test("longestCommonSubstring finds the shared run", () => {
  assert.equal(
    CA.longestCommonSubstring(["Salesforce - Search", "Salesforce - Account"]),
    "Salesforce - ");
  assert.equal(CA.longestCommonSubstring(["abc", "xyz"]), "");
  assert.equal(CA.longestCommonSubstring(["only one"]), "only one");
  assert.equal(CA.longestCommonSubstring([]), "");
});

test("interactionMatches honours process_name, regex, and interaction fields", () => {
  const ev = interaction("e1", {
    process_name: "chrome.exe", window_title: "Salesforce - Search",
    control_type: "Edit", automation_id: "searchInput", name: "Search box",
  });
  assert.equal(CA.interactionMatches({ process_name: "chrome.exe" }, ev), true);
  assert.equal(CA.interactionMatches({ process_name: "OUTLOOK.EXE" }, ev), false);
  assert.equal(CA.interactionMatches({ window_title_regex: ".*Salesforce.*" }, ev), true);
  assert.equal(CA.interactionMatches({ window_title_regex: ".*KYC.*" }, ev), false);
  assert.equal(CA.interactionMatches({ interaction: { control_type: "Edit" } }, ev), true);
  assert.equal(CA.interactionMatches({ interaction: { control_type: "Button" } }, ev), false);
  assert.equal(CA.interactionMatches({ interaction: { automation_id: "searchInput" } }, ev), true);
});

test("interactionMatches treats an invalid regex as a non-match, not a throw", () => {
  const ev = interaction("e1", { window_title: "anything" });
  assert.equal(CA.interactionMatches({ window_title_regex: "([" }, ev), false);
});

test("deriveMatchRule returns null for an empty interaction set", () => {
  assert.equal(CA.deriveMatchRule([]), null);
  assert.equal(CA.deriveMatchRule(null), null);
});

test("deriveMatchRule sets process_name only when every interaction agrees", () => {
  const same = [
    interaction("a", { process_name: "chrome.exe", window_title: "x" }),
    interaction("b", { process_name: "chrome.exe", window_title: "y" }),
  ];
  assert.equal(CA.deriveMatchRule(same).process_name, "chrome.exe");
  // Mixed processes with nothing else shared -> no rule at all.
  const mixed = [
    interaction("a", { process_name: "chrome.exe" }),
    interaction("b", { process_name: "OUTLOOK.EXE" }),
  ];
  assert.equal(CA.deriveMatchRule(mixed), null);
});

test("deriveMatchRule generalises a shared window-title substring into a regex", () => {
  const ints = [
    interaction("a", { process_name: "chrome.exe", window_title: "Salesforce Search page" }),
    interaction("b", { process_name: "chrome.exe", window_title: "Salesforce Search results" }),
  ];
  const rule = CA.deriveMatchRule(ints);
  assert.ok(rule.window_title_regex.includes("Salesforce Search"));
  // The derived regex must actually fire on the interactions it came from.
  assert.equal(CA.interactionMatches(rule, ints[0]), true);
  assert.equal(CA.interactionMatches(rule, ints[1]), true);
});

test("deriveMatchRule captures a consistent control_type / automation_id", () => {
  const ints = [
    interaction("a", { process_name: "chrome.exe", control_type: "Edit", automation_id: "q" }),
    interaction("b", { process_name: "chrome.exe", control_type: "Edit", automation_id: "q" }),
  ];
  const rule = CA.deriveMatchRule(ints);
  assert.equal(rule.interaction.control_type, "Edit");
  assert.equal(rule.interaction.automation_id, "q");
});

test("stepsToTemplateSteps carries name + description and derives a rule", () => {
  const events = [
    interaction("i1", { process_name: "chrome.exe", window_title: "Salesforce Account" }),
    interaction("i2", { process_name: "chrome.exe", window_title: "Salesforce Account new" }),
  ];
  const steps = [
    { name: "Open account", description: "in CRM",
      evidence: { interaction_event_ids: ["i1", "i2"] } },
  ];
  const out = CA.stepsToTemplateSteps(steps, events);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Open account");
  assert.equal(out[0].description, "in CRM");
  assert.ok(typeof out[0].step_id === "string" && out[0].step_id.length > 0);
  assert.equal(out[0].match.length, 1);
  assert.equal(out[0].match[0].process_name, "chrome.exe");
});

test("stepsToTemplateSteps yields an empty match when a step cites no interactions", () => {
  const out = CA.stepsToTemplateSteps(
    [{ name: "Manual step", evidence: { interaction_event_ids: [] } }], []);
  assert.deepEqual(out[0].match, []);
  assert.equal(out[0].name, "Manual step");
});

test("stepsToTemplateSteps gives every step a distinct step_id", () => {
  const out = CA.stepsToTemplateSteps([{ name: "A" }, { name: "B" }, { name: "C" }], []);
  assert.equal(new Set(out.map((s) => s.step_id)).size, 3);
});

test("stepsToTemplateSteps auto-links a derived rule to a matching vocab", () => {
  const events = [interaction("i1", { process_name: "chrome.exe", automation_id: "searchBox" })];
  const steps = [{ name: "Search", evidence: { interaction_event_ids: ["i1"] } }];
  const vocabs = [vocab("salesforce", { process_name: "chrome.exe" }, [
    { signature: { automation_id: "searchBox" }, name: "Customer search" },
  ])];
  const out = CA.stepsToTemplateSteps(steps, events, vocabs);
  assert.deepEqual(out[0].match[0].library_ref,
    { vocab_id: "salesforce", interaction: "Customer search" });
});

test("canonicalSkeleton nests under canonical_process with sane defaults", () => {
  const sk = CA.canonicalSkeleton("Customer Onboarding");
  assert.ok(sk.canonical_process);
  assert.equal(sk.canonical_process.id, "customer-onboarding");
  assert.equal(sk.canonical_process.name, "Customer Onboarding");
  assert.equal(sk.canonical_process.version, 1);
  assert.deepEqual(sk.canonical_process.steps, []);
});

test("canonicalSkeleton accepts pre-built steps", () => {
  const sk = CA.canonicalSkeleton("P", [{ step_id: "s1", name: "Step 1", match: [] }]);
  assert.equal(sk.canonical_process.steps.length, 1);
  assert.equal(sk.canonical_process.steps[0].name, "Step 1");
});

/* ---- Phase authoring helpers ---- */

test("ensurePhase creates a phase with a slugified id when absent", () => {
  const proc = {};
  const id = CA.ensurePhase(proc, "Validate Customers");
  assert.equal(id, "validate-customers");
  assert.equal(proc.phases.length, 1);
  assert.deepEqual(proc.phases[0],
    { phase_id: "validate-customers", name: "Validate Customers", step_ids: [] });
});

test("ensurePhase returns the existing phase_id for a known name (case-insensitive)", () => {
  const proc = { phases: [{ phase_id: "validate", name: "Validate", step_ids: ["s1"] }] };
  assert.equal(CA.ensurePhase(proc, "  validate "), "validate");
  assert.equal(proc.phases.length, 1); // nothing added
});

test("ensurePhase de-collides a slug already taken by another phase", () => {
  const proc = { phases: [{ phase_id: "validate", name: "Validation done", step_ids: [] }] };
  const id = CA.ensurePhase(proc, "Validate");
  assert.equal(id, "validate-2");
  assert.equal(proc.phases.length, 2);
});

test("ensurePhase returns null and creates nothing for a blank name", () => {
  const proc = {};
  assert.equal(CA.ensurePhase(proc, "   "), null);
  assert.equal(CA.ensurePhase(proc, null), null);
  assert.equal(proc.phases, undefined);
});

test("assignStepToPhase moves a step from one phase to another", () => {
  const proc = { phases: [
    { phase_id: "a", name: "A", step_ids: ["s1", "s2"] },
    { phase_id: "b", name: "B", step_ids: ["s3"] },
  ] };
  CA.assignStepToPhase(proc, "s1", "b");
  assert.deepEqual(proc.phases.find((p) => p.phase_id === "a").step_ids, ["s2"]);
  assert.deepEqual(proc.phases.find((p) => p.phase_id === "b").step_ids, ["s3", "s1"]);
});

test("assignStepToPhase with a null target unassigns the step", () => {
  const proc = { phases: [{ phase_id: "a", name: "A", step_ids: ["s1", "s2"] }] };
  CA.assignStepToPhase(proc, "s1", null);
  assert.deepEqual(proc.phases[0].step_ids, ["s2"]);
});

test("assignStepToPhase drops a phase left with no steps", () => {
  const proc = { phases: [{ phase_id: "a", name: "A", step_ids: ["s1"] }] };
  CA.assignStepToPhase(proc, "s1", null);
  assert.deepEqual(proc.phases, []);
});

test("assignStepToPhase does not duplicate a step already in the target", () => {
  const proc = { phases: [{ phase_id: "a", name: "A", step_ids: ["s1"] }] };
  CA.assignStepToPhase(proc, "s1", "a");
  assert.deepEqual(proc.phases[0].step_ids, ["s1"]);
});

test("assignStepToPhase no-ops on a falsy stepId and tolerates missing phases", () => {
  const proc = {};
  CA.assignStepToPhase(proc, "", "a");
  assert.equal(proc.phases, undefined); // returns before touching proc
  CA.assignStepToPhase(proc, "s1", "missing-phase"); // target absent -> step unassigned
  assert.deepEqual(proc.phases, []);
});

test("ensurePhase + assignStepToPhase compose to author a phase inline", () => {
  const proc = { steps: [{ step_id: "s1" }, { step_id: "s2" }] };
  const id = CA.ensurePhase(proc, "Onboard");
  CA.assignStepToPhase(proc, "s1", id);
  CA.assignStepToPhase(proc, "s2", id);
  assert.equal(proc.phases.length, 1);
  assert.deepEqual(proc.phases[0].step_ids, ["s1", "s2"]);
});

/* ---- App Library integration helpers ---- */

function vocab(id, scope, interactions) {
  return { id, name: id, version: 1, scope: scope || {}, interactions: interactions || [] };
}

test("vocabSignatureKey prefers automation_id, then control_type+name, then name", () => {
  assert.equal(CA.vocabSignatureKey({ automation_id: "searchBox", control_type: "Edit" }), "aid|searchBox");
  assert.equal(CA.vocabSignatureKey({ control_type: "Button", name: "Save" }), "ctn|Button|Save");
  assert.equal(CA.vocabSignatureKey({ name: "Save" }), "n|Save");
  assert.equal(CA.vocabSignatureKey({ control_type: "Button" }), null);
  assert.equal(CA.vocabSignatureKey({}), null);
});

test("signatureFromInteraction picks the minimum identifying signature", () => {
  assert.deepEqual(
    CA.signatureFromInteraction({ data: { automation_id: "q", control_type: "Edit", name: "x" } }),
    { automation_id: "q", control_type: "Edit" });
  assert.deepEqual(
    CA.signatureFromInteraction({ data: { control_type: "Button", name: "Save" } }),
    { control_type: "Button", name: "Save" });
  assert.deepEqual(CA.signatureFromInteraction({ data: { name: "Only" } }), { name: "Only" });
  assert.equal(CA.signatureFromInteraction({ data: {} }), null);
  assert.deepEqual(CA.signatureFromInteraction({ automation_id: "z" }), { automation_id: "z" });
});

test("mergeInteractionsIntoVocab appends novel signatures and skips duplicates", () => {
  const v = vocab("salesforce", { process_name: "chrome.exe" }, [
    { signature: { automation_id: "searchBox" }, name: "Customer search" },
  ]);
  const r = CA.mergeInteractionsIntoVocab(v, [
    { signature: { automation_id: "searchBox" }, name: "RAW (dup)" },
    { signature: { automation_id: "saveBtn" }, name: "Save" },
  ]);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.vocab.interactions.length, 2);
  // existing entry kept -- its curated name survives, the dup's discarded
  assert.equal(r.vocab.interactions[0].name, "Customer search");
  assert.equal(v.interactions.length, 1); // input not mutated
});

test("vocabInteractionToRule builds a hybrid rule with a library_ref", () => {
  const v = vocab("salesforce",
    { process_name: "chrome.exe", window_title_regex: ".*Salesforce.*" }, []);
  const entry = { signature: { control_type: "Edit", automation_id: "searchBox" }, name: "Customer search" };
  const rule = CA.vocabInteractionToRule(v, entry);
  assert.deepEqual(rule.library_ref, { vocab_id: "salesforce", interaction: "Customer search" });
  assert.equal(rule.process_name, "chrome.exe");
  assert.equal(rule.window_title_regex, ".*Salesforce.*");
  assert.deepEqual(rule.interaction, { control_type: "Edit", automation_id: "searchBox" });
});

test("recognizeRule links a literal rule back to a matching Library entry", () => {
  const vocabs = [vocab("salesforce", { process_name: "chrome.exe" }, [
    { signature: { automation_id: "searchBox" }, name: "Customer search" },
  ])];
  assert.deepEqual(
    CA.recognizeRule({ process_name: "chrome.exe", interaction: { automation_id: "searchBox" } }, vocabs),
    { vocab_id: "salesforce", interaction: "Customer search" });
  // a coarse rule (no interaction block) is not recognizable
  assert.equal(CA.recognizeRule({ process_name: "chrome.exe", window_title_regex: ".*x.*" }, vocabs), null);
  assert.equal(CA.recognizeRule({ interaction: { automation_id: "nope" } }, vocabs), null);
});

test("ruleDrift detects a hybrid rule whose cache lags the Library entry", () => {
  const v = vocab("salesforce", { process_name: "chrome.exe" }, [
    { signature: { automation_id: "searchBox" }, name: "Customer search" },
  ]);
  const fresh = CA.vocabInteractionToRule(v, v.interactions[0]);
  assert.equal(CA.ruleDrift(fresh, [v]), false);
  const drifted = Object.assign({}, fresh, { interaction: { automation_id: "OLD_id" } });
  assert.equal(CA.ruleDrift(drifted, [v]), true);
  assert.equal(CA.ruleDrift({ process_name: "chrome.exe" }, [v]), false); // no ref
  assert.equal(CA.ruleDrift(fresh, []), false); // unresolved, not drift
});

/* ---- §D3 (flywheel): the accepted anchor rides into the template ---- */

test("anchorFromOverride strips audit fields and nulls, defaults case_label_from", () => {
  const override = {
    field: "automation_id",
    equals: "customer-id-field",
    min_case_interactions: 2,
    min_case_duration_ms: 1000,
    nothing: null,
    _accepted_signature: "abc123def456",
    _accepted_at: "2026-06-10T09:00:00Z",
    _accepted_by: "analyst",
  };
  const a = CA.anchorFromOverride(override);
  assert.deepEqual(a, {
    field: "automation_id",
    equals: "customer-id-field",
    min_case_interactions: 2,
    min_case_duration_ms: 1000,
    case_label_from: "value",
  });
  // An explicit case_label_from is kept, not clobbered.
  assert.equal(CA.anchorFromOverride({ field: "name", case_label_from: "name" }).case_label_from, "name");
  // A recognized-category anchor needs no field.
  assert.deepEqual(CA.anchorFromOverride({ recognized: "search" }),
    { recognized: "search", case_label_from: "value" });
});

test("anchorFromOverride rejects absent / malformed overrides", () => {
  assert.equal(CA.anchorFromOverride(null), null);
  assert.equal(CA.anchorFromOverride(undefined), null);
  assert.equal(CA.anchorFromOverride("x"), null);
  assert.equal(CA.anchorFromOverride([]), null);
  assert.equal(CA.anchorFromOverride({}), null);                       // no field, no recognized
  assert.equal(CA.anchorFromOverride({ field: { equals: "x" } }), null); // field must be a string
});

test("canonicalSkeleton carries opts.caseAnchor into canonical_process.case_anchor", () => {
  const anchor = { field: "automation_id", equals: "customer-id-field", case_label_from: "value" };
  const sk = CA.canonicalSkeleton("Order Process", [], { caseAnchor: anchor });
  assert.deepEqual(sk.canonical_process.case_anchor, anchor);
  // Without the option the key is absent entirely (not null) -- an
  // anchor-less template stays byte-compatible with the old shape.
  assert.ok(!("case_anchor" in CA.canonicalSkeleton("P").canonical_process));
});
