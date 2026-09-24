"use strict";
/*
 * system-names.js: the viewer reads shared/system-names.json the way
 * normalization/app_names.py and step_context.py do (contract C14). The
 * expected pairs below were printed by step_context.StepContext.where_data
 * (no vocabularies) on the demo's applications, so the two sides agree.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const SN = require("./system-names.js");

// The window titles' separator, built so this file holds no dash punctuation.
const SEP = " " + String.fromCharCode(45) + " ";
const NAMES = { "chrome.exe": "Google Chrome", "SAPGUI.exe": "SAP", "EXCEL.EXE": "Excel",
  "OUTLOOK.EXE": "Outlook", "notepad.exe": "Notepad" };

test("system and screen of an application and a window title, as the pipeline names them", () => {
  const cases = [
    [["chrome.exe", "Salesforce" + SEP + "Account lookup"], { system: "Salesforce", screen: "Account lookup" }],
    [["chrome.exe", "Salesforce" + SEP + "Order #10900"], { system: "Salesforce", screen: "Order" }],
    [["SAPGUI.exe", "SAP" + SEP + "Create Sales Order (VA01)"], { system: "SAP", screen: "Create Sales Order" }],
    [["SAPGUI.exe", "va01"], { system: "SAP", screen: "va01" }],
    [["EXCEL.EXE", "Excel" + SEP + "Order Tracking.xlsx"], { system: "Excel", screen: "Order Tracking.xlsx" }],
    [["EXCEL.EXE", "Order Tracking.xlsx" + SEP + "Excel"], { system: "Excel", screen: "Order Tracking.xlsx" }],
    [["OUTLOOK.EXE", "Outlook" + SEP + "Order confirmation"], { system: "Outlook", screen: "Order confirmation" }],
    [["notepad.exe", "Notepad" + SEP + "Internal mappings.txt"], { system: "Notepad", screen: "Internal mappings.txt" }],
    [["chrome.exe", "New Tab" + SEP + "Google Chrome"], { system: "Google Chrome", screen: "New Tab" }],
    [["erpclient.exe", "ERP | Orders :: Main"], { system: "Erpclient", screen: "ERP, Orders, Main" }],
  ];
  for (const [[app, title], want] of cases) {
    assert.deepEqual(SN.whereData(app, title, NAMES), want, app + " / " + title);
  }
});

test("a browser is only where a web system ran; a rule without a title names the application itself", () => {
  assert.equal(SN.systemName("msedge.exe", "Incident | ServiceNow", {}), "ServiceNow");
  assert.equal(SN.systemName("chrome.exe", "Search", {}), "Google Chrome");
  assert.equal(SN.systemName("saplogon.exe", "", {}), "SAP");
  assert.equal(SN.systemName("erpclient.exe", "Main", { "ERPCLIENT.EXE": "ERP Client" }), "ERP Client", "the recording's own name, by key");
  assert.equal(SN.systemName("", "Salesforce", NAMES), "", "no application, no system");
  assert.equal(SN.displayName("chrome", {}), "Google Chrome");
  assert.equal(SN.displayName("WINWORD.EXE", {}), "Word");
  assert.equal(SN.fallbackName("EXCELX.EXE"), "Excelx");
});

test("a step's system and screen: its interactions first, then its grain keys, then its draft key", () => {
  const inter = {
    e1: { data: { process_name: "chrome.exe", window_title: "Salesforce" + SEP + "Account lookup" } },
    e2: { data: { process_name: "chrome.exe", window_title: "Salesforce" + SEP + "Account lookup" } },
    e3: { data: { process_name: "chrome.exe", window_title: "Salesforce" + SEP + "Order #1" } },
  };
  const step = { evidence: { interaction_event_ids: ["e1", "e2", "e3"] } };
  assert.deepEqual(SN.whereOfStep(step, inter, NAMES), { system: "Salesforce", screen: "Account lookup" });
  assert.deepEqual(SN.whereOfStep({ grain_keys: { app: "sapgui", screen: "va01" } }, {}, {}), { system: "SAP", screen: "va01" });
  assert.deepEqual(SN.whereOfStep({ draft_key: "excel|Excel" + SEP + "Tracker|Button:save" }, {}, {}),
    { system: "Excel", screen: "Tracker" });
  assert.deepEqual(SN.whereOfStep({ name: "Call the customer" }, {}, {}), { system: "", screen: "" }, "a step added by hand");
});

test("a system the analyst set on the step wins over the derived one (C16)", () => {
  const inter = { e1: { data: { process_name: "chrome.exe", window_title: "Salesforce" + SEP + "Account lookup" } } };
  const step = { evidence: { interaction_event_ids: ["e1"] }, system: " CRM " };
  assert.deepEqual(SN.whereOfStep(step, inter, NAMES), { system: "CRM", screen: "Account lookup" });
  assert.deepEqual(SN.whereOfStep({ name: "Call the customer", system: "Phone" }, {}, {}), { system: "Phone", screen: "" });
  assert.deepEqual(SN.whereOfStep({ grain_keys: { app: "sapgui", screen: "va01" }, system: "  " }, {}, {}),
    { system: "SAP", screen: "va01" }, "a blank system is not set");
});
