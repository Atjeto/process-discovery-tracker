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

test("lane FX2: the systems each application stands for in a recording, the most used first (the Apps outside the process dialog names them)", () => {
  const ev = (proc, title) => ({ type: "interaction", data: { process_name: proc, window_title: title } });
  const events = [
    ev("chrome.exe", "Salesforce" + SEP + "Account lookup"), ev("chrome.exe", "Incident | ServiceNow"),
    ev("chrome.exe", "Salesforce" + SEP + "Order #10900"), ev("notepad.exe", "Notepad" + SEP + "Internal mappings.txt"),
    { type: "activity", data: { app: "EXCEL.EXE", title: "Excel" } }, ev("", "no process"),
  ];
  assert.deepEqual(SN.appSystems(events, NAMES), {
    "chrome.exe": ["Salesforce", "ServiceNow"],
    "notepad.exe": ["Notepad"],
  });
  assert.deepEqual(SN.appSystems([], NAMES), {});
  assert.deepEqual(SN.appSystems([ev("chrome.exe", "New Tab")], NAMES), { "chrome.exe": ["Google Chrome"] }, "a browser on no web system is the browser");
});

test("lane LF-PIPE: the Windows apps read by their names; a page's system is its site when the list knows it, else the browser", () => {
  assert.equal(SN.systemName("CalculatorApp.exe", "Calculator", {}), "Calculator");
  assert.equal(SN.systemName("charmap.exe", "Character Map", {}), "Character Map");
  assert.equal(SN.systemName("mspaint.exe", "Untitled" + SEP + "Paint", {}), "Paint");
  assert.equal(SN.systemName("explorer.exe", "Documents", {}), "File Explorer");
  assert.equal(SN.systemName("WINWORD.EXE", "letter.docx" + SEP + "Word", {}), "Word");
  assert.equal(SN.systemName("OUTLOOK.EXE", "Inbox", {}), "Outlook");
  assert.equal(SN.systemName("chrome.exe", "Contoso | Account | Salesforce", {}), "Salesforce");
  // 2.0.1: a site no rule names is named by the title's last segment.
  assert.equal(SN.systemName("chrome.exe", "Customer lookup" + SEP + "Order Desk", {}), "Order Desk");
  assert.equal(SN.systemName("chrome.exe", "Customer lookup" + SEP + "Order Desk" + SEP + "Google Chrome", {}), "Order Desk");
  assert.equal(SN.systemName("msedge.exe", "Page" + SEP + "Order Desk and 3 more pages" + SEP + "Microsoft\u200b Edge", {}), "Order Desk");
  assert.equal(SN.systemName("chrome.exe", "New Tab" + SEP + "Google Chrome", {}), "Google Chrome", "one segment is a page, not a site");
  assert.equal(SN.systemName("chrome.exe", "Orders" + SEP + "SO12345", {}), "Google Chrome", "a value is not a site");
  assert.equal(SN.systemName("EXCEL.EXE", "Order Desk" + SEP + "Excel", {}), "Excel", "the site rule is for browsers");
  assert.equal(SN.siteName("Order Desk", new Set()), "");
  assert.ok(!SN.knownSystems().includes(""), "a site rule adds no name to the System field's list");
  assert.equal(SN.systemName("msedge.exe", "Order Desk", {}), "Microsoft Edge");
  for (const s of ["Calculator", "Character Map", "Paint", "File Explorer"]) assert.ok(SN.knownSystems().includes(s), s);
});

test("2.0.1: a program named as Windows names it (the capture app's window in front) is its executable, so the Timeline names a system as the steps do", () => {
  assert.equal(SN.appKey("Google Chrome"), "chrome");
  assert.equal(SN.appKey("Microsoft\u200b Edge"), "msedge");
  assert.equal(SN.appKey("Microsoft Excel"), "excel");
  assert.equal(SN.appKey("Erpclient.exe"), "erpclient");
  assert.equal(SN.systemName("Google Chrome", "Customer lookup" + SEP + "Order Desk" + SEP + "Google Chrome", {}), "Order Desk");
  assert.equal(SN.systemName("Google Chrome", "Account lookup | Salesforce" + SEP + "Google Chrome", {}), "Salesforce");
  assert.equal(SN.systemName("Google Chrome", "New Tab" + SEP + "Google Chrome", {}), "Google Chrome");
  assert.equal(SN.systemName("Microsoft Excel", "orders-week40.xlsx" + SEP + "Excel", {}), "Excel");
  assert.equal(SN.systemName("Microsoft Outlook", "Inbox" + SEP + "Outlook", {}), "Outlook");
});

test("lane LF-PIPE (#24): a map box leaves its system line out when the step's name already names the system", () => {
  assert.equal(SN.namesSystem("orders.xlsx" + SEP + "Excel: Save", "Excel"), true);
  assert.equal(SN.namesSystem("Account | Salesforce: Save", "salesforce"), true, "ignoring case");
  assert.equal(SN.namesSystem("Excelsior orders: Save", "Excel"), false, "whole words only");
  assert.equal(SN.namesSystem("Customer lookup" + SEP + "Order Desk: Search", "Google Chrome"), false);
  assert.equal(SN.namesSystem("Customer lookup" + SEP + "Order Desk: Search", "Order Desk"), true);
  assert.equal(SN.systemLine("orders.xlsx" + SEP + "Excel: Save", "Excel"), "");
  assert.equal(SN.systemLine("Customer lookup" + SEP + "Order Desk: Search", "Google Chrome"), "Google Chrome");
  assert.equal(SN.systemLine("Check the stock", ""), "");
  assert.equal(SN.systemLine("Log it in SAP (VA01)", "SAP"), "");
});

test("lane LF-PIPE: a step whose click lost its program in the recording takes the program the pipeline filled in (its grain keys)", () => {
  const inter = { c: { data: { kind: "invoked", name: "Select", window_title: "Customer lookup" + SEP + "Order Desk" + SEP + "Google Chrome" } } };
  const step = { evidence: { interaction_event_ids: ["c"] }, grain_keys: { app: "chrome", screen: "Customer lookup" + SEP + "Order Desk" + SEP + "Google Chrome" } };
  assert.deepEqual(SN.whereOfStep(step, inter, {}), { system: "Order Desk", screen: "Customer lookup" });
  const bare = { evidence: { interaction_event_ids: ["c"] }, grain_keys: { app: "(app)", screen: "(screen)" } };
  assert.deepEqual(SN.whereOfStep(bare, inter, {}), { system: "", screen: "Customer lookup, Order Desk" });
});
