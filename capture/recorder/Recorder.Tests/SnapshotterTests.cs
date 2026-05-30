using System.Collections.Generic;
using System.Linq;
using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Seed tests for the ADR-0025 snapshot walker, run over a synthetic
// ISnapshotElement tree so the traversal + emission logic is pinned without
// a live UI-Automation desktop (which can't be constructed in a unit test).
public class SnapshotterTests {

    // A synthetic UIA node. Any of the identity fields may be null/empty to
    // model real controls (Salesforce label-keyed fields have no aid; pure
    // decoration has nothing at all).
    private sealed class FakeElement : ISnapshotElement {
        public string? ControlType { get; init; }
        public string? AutomationId { get; init; }
        public string? Name { get; init; }
        public string? ClassName { get; init; }
        public string? FrameworkId { get; init; }
        public string? Role { get; init; }
        public (int x, int y, int w, int h)? Bounds { get; init; }
        public IEnumerable<ISnapshotElement> Children { get; init; } = new List<ISnapshotElement>();
    }

    private static FakeElement Tree(params ISnapshotElement[] kids) => new() {
        ControlType = "Window", Name = "Acme - Salesforce", ClassName = "Chrome_WidgetWin_1",
        FrameworkId = "Chrome", Role = "window",
        Children = kids,
    };

    // A snapshot of a synthetic tree must emit exactly the identity-bearing
    // controls, carry the ADR-0023 identity/confidence ladder, record depth +
    // pass, and SKIP pure decoration (no aid/name/class).
    [Fact]
    public void Walk_emits_identity_bearing_controls_and_skips_decoration() {
        var root = Tree(
            // Office-style stable automation_id button.
            new FakeElement {
                ControlType = "Button", AutomationId = "FileSave", Name = "Save",
                ClassName = "NetUIRibbonButton", FrameworkId = "Win32", Role = "button",
                Bounds = (10, 20, 80, 24),
            },
            // Salesforce-style label-only field (auto-generated aid omitted as
            // volatile -> here it simply has no aid; identity is the label).
            new FakeElement {
                ControlType = "Edit", Name = "Account Name",
                ClassName = "slds-input", FrameworkId = "Chrome", Role = "edit",
            },
            // Pure decoration: no aid, no name, no class -> identity "none" -> skipped.
            new FakeElement { ControlType = "Pane", FrameworkId = "Chrome" }
        );

        var controls = SnapshotWalker.Walk(root, pass: 1);

        // The window itself (has a Name) + the two real controls = 3; the
        // decoration pane is dropped.
        Assert.Equal(3, controls.Count);
        Assert.DoesNotContain(controls, c => (string?)c["control_type"] == "Pane");

        var save = controls.Single(c => (string?)c["automation_id"] == "FileSave");
        Assert.Equal("automation_id", save["identity_source"]);
        Assert.Equal(0.95, save["confidence"]);
        Assert.Equal("win32", save["framework"]);
        Assert.Equal(1, save["depth"]);
        Assert.Equal(1, save["pass"]);

        var acct = controls.Single(c => (string?)c["name"] == "Account Name");
        Assert.Null(acct["automation_id"]);
        Assert.Equal("name", acct["identity_source"]);   // label-keyed, not aid
        Assert.Equal("chromium", acct["framework"]);

        // The root window is emitted at depth 0.
        Assert.Equal(0, controls.Single(c => (string?)c["control_type"] == "Window")["depth"]);
    }

    // Two passes over a tree whose automation_id MUTATED between passes (the
    // Salesforce input-378 -> input-411 regeneration) must BOTH be captured,
    // tagged with their pass number, so the downstream picker can diff and
    // demote the volatile id. Asserts both passes captured the control AND the
    // id genuinely differs across them.
    [Fact]
    public void Walk_two_passes_capture_a_mutated_automation_id() {
        ISnapshotElement PassTree(string volatileAid) => Tree(
            new FakeElement {
                ControlType = "Edit", AutomationId = volatileAid, Name = "Account Name",
                ClassName = "slds-input", FrameworkId = "Chrome", Role = "edit",
            });

        var pass1 = SnapshotWalker.Walk(PassTree("input-378"), pass: 1);
        var pass2 = SnapshotWalker.Walk(PassTree("input-411"), pass: 2);

        var c1 = pass1.Single(c => (string?)c["control_type"] == "Edit");
        var c2 = pass2.Single(c => (string?)c["control_type"] == "Edit");

        Assert.Equal(1, c1["pass"]);
        Assert.Equal(2, c2["pass"]);
        // Same accessible label across passes (the stable join key) ...
        Assert.Equal(c1["name"], c2["name"]);
        // ... but the automation_id changed -> the picker's volatility signal.
        Assert.NotEqual(c1["automation_id"], c2["automation_id"]);
        Assert.Equal("input-378", c1["automation_id"]);
        Assert.Equal("input-411", c2["automation_id"]);
    }

    // The emitted-control cap is honoured (a dense form can't flood the host).
    [Fact]
    public void Walk_caps_emitted_controls() {
        var kids = Enumerable.Range(0, 50).Select(i => (ISnapshotElement)new FakeElement {
            ControlType = "Button", AutomationId = $"btn-{i}", Name = $"B{i}",
            FrameworkId = "Win32", Role = "button",
        }).ToArray();
        var root = Tree(kids);

        var controls = SnapshotWalker.Walk(root, pass: 1, maxControls: 10);
        Assert.Equal(10, controls.Count);
    }

    // bounds are emitted when present and omitted when UIA reports none.
    [Fact]
    public void Walk_emits_bounds_only_when_present() {
        var root = Tree(
            new FakeElement { ControlType = "Button", AutomationId = "a", Bounds = (1, 2, 3, 4) },
            new FakeElement { ControlType = "Button", AutomationId = "b" }
        );
        var controls = SnapshotWalker.Walk(root, pass: 1);
        Assert.True(controls.Single(c => (string?)c["automation_id"] == "a").ContainsKey("bounds"));
        Assert.False(controls.Single(c => (string?)c["automation_id"] == "b").ContainsKey("bounds"));
    }
}
