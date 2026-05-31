// One-shot UIA window snapshot for in-app vocabulary discovery (ADR-0025).
//
// Where UiaSubscriber SUBSCRIBES to interaction events over the session's
// lifetime, the Snapshotter walks a single target window's UIA subtree ONCE
// (per pass) and emits EVERY identifiable control -- so the analyst can
// discover an app's vocabulary by pointing at a prepared window instead of
// waiting to interact with each control.
//
// Two passes ≥1s apart let the downstream volatility-diff picker
// (normalization/signature_pick.py) tell a STABLE automation_id from a
// per-render volatile one (Salesforce Lightning's input-378 -> input-411):
// an id that changes across passes for the same control is demoted in favour
// of the accessible label. See ADR-0025 + ADR-0023 (the identity/confidence
// model reused here).
//
// The walk is split into a PURE traversal (SnapshotWalker over the
// ISnapshotElement seam, unit-tested with a synthetic tree) and a thin live
// adapter (LiveSnapshotElement over AutomationElement) -- the same
// pure-logic / UIA-seam discipline as UiaSubscriber's static helpers.

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Automation;

namespace Pdt.Recorder;

/// <summary>
/// The minimal view of a UIA element the snapshot walker needs. Abstracted
/// so SnapshotWalker can run over a synthetic tree in tests without a live
/// AutomationElement (which can't be constructed off a real desktop).
/// </summary>
public interface ISnapshotElement {
    string? ControlType { get; }
    string? AutomationId { get; }
    string? Name { get; }
    string? ClassName { get; }
    string? FrameworkId { get; }
    /// <summary>UIA LocalizedControlType -- the human "role" word ("button").</summary>
    string? Role { get; }
    /// <summary>On-screen rectangle, or null when UIA reports none / off-screen.</summary>
    (int x, int y, int w, int h)? Bounds { get; }
    IEnumerable<ISnapshotElement> Children { get; }
}

public static class SnapshotWalker {
    // Default cap on EMITTED controls (those with a non-empty identity). A
    // prepared form is a few hundred controls; 2000 covers dense apps while
    // bounding a pathological tree. (ADR-0025: "cap ~2000 controls".)
    public const int DefaultMaxControls = 2000;
    // Independent guard on total VISITED nodes so a huge decoration-only
    // subtree (which emits nothing) can't make the walk run unbounded.
    private const int MaxVisitedMultiplier = 20;
    // Hard depth cap. A real app window is a few dozen levels deep; beyond
    // this is a pathological (or cyclic) tree -- stop descending. The walk is
    // iterative (an explicit stack), so this also can't blow the call stack.
    private const int MaxDepth = 200;

    /// <summary>
    /// Build the emitted control record for one element. Pure: reuses the
    /// ADR-0023 identity/framework/confidence ladder from UiaSubscriber so a
    /// snapshot control and a captured interaction agree on identity_source /
    /// framework / confidence. Returns null when the element has NO identity
    /// (no automation_id / name / class_name) -- pure decoration we skip.
    /// </summary>
    internal static Dictionary<string, object?>? BuildControl(
            string? controlType, string? automationId, string? name,
            string? className, string? frameworkId, string? role,
            (int x, int y, int w, int h)? bounds, int depth, int pass) {
        var identitySource = UiaSubscriber.ResolveIdentitySource(automationId, name, className);
        if (identitySource == "none") return null;   // nothing to key a signature on
        var framework = UiaSubscriber.DetectFramework(frameworkId, className);
        var confidence = UiaSubscriber.ComputeConfidence(identitySource, framework);
        var d = new Dictionary<string, object?> {
            ["control_type"] = controlType,
            ["automation_id"] = automationId,
            ["name"] = name,
            ["class_name"] = className,
            ["framework_id"] = frameworkId,
            ["framework"] = framework,
            ["identity_source"] = identitySource,
            ["confidence"] = confidence,
            ["role"] = role,
            ["depth"] = depth,
            ["pass"] = pass,
        };
        if (bounds.HasValue) {
            var b = bounds.Value;
            d["bounds"] = new { x = b.x, y = b.y, w = b.w, h = b.h };
        }
        return d;
    }

    /// <summary>
    /// Walk <paramref name="root"/>'s subtree depth-first, returning the
    /// emitted control records (identity-bearing controls only) in document
    /// order with their tree depth. Bounded by <paramref name="maxControls"/>
    /// emitted records and a proportional visited-node guard. A child
    /// enumeration that throws is treated as "no more children" (a window
    /// closing mid-walk must not abort the snapshot).
    /// </summary>
    public static List<Dictionary<string, object?>> Walk(
            ISnapshotElement root, int pass, int maxControls = DefaultMaxControls) {
        var outList = new List<Dictionary<string, object?>>();
        if (root == null) return outList;
        var maxVisited = maxControls * MaxVisitedMultiplier;
        var visited = 0;

        // Iterative pre-order DFS (an explicit stack, never recursion) so a
        // deep or cyclic UIA tree can't overflow the call stack. Children are
        // pushed in reverse so they pop back into document order.
        var stack = new Stack<(ISnapshotElement el, int depth)>();
        stack.Push((root, 0));
        while (stack.Count > 0) {
            if (outList.Count >= maxControls || visited >= maxVisited) break;
            var (el, depth) = stack.Pop();
            visited++;
            var rec = BuildControl(
                el.ControlType, el.AutomationId, el.Name, el.ClassName,
                el.FrameworkId, el.Role, SafeBounds(el), depth, pass);
            if (rec != null) outList.Add(rec);
            if (depth >= MaxDepth) continue;
            var kids = new List<ISnapshotElement>();
            foreach (var c in SafeChildren(el)) {
                kids.Add(c);
                if (kids.Count >= maxVisited) break;   // bound a pathological fan-out
            }
            for (var i = kids.Count - 1; i >= 0; i--) {
                stack.Push((kids[i], depth + 1));
            }
        }
        return outList;
    }

    private static (int x, int y, int w, int h)? SafeBounds(ISnapshotElement el) {
        try { return el.Bounds; } catch { return null; }
    }

    private static IEnumerable<ISnapshotElement> SafeChildren(ISnapshotElement el) {
        IEnumerable<ISnapshotElement>? children = null;
        try { children = el.Children; } catch { }
        return children ?? Array.Empty<ISnapshotElement>();
    }
}

/// <summary>
/// Resolves the target window and drives the two-pass snapshot, emitting
/// snapshot_control / snapshot_done NDJSON lines through the supplied writer.
/// </summary>
public static class Snapshotter {
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    /// <summary>
    /// Run <paramref name="passes"/> snapshot passes of the window named by
    /// <paramref name="target"/> ("foreground" or a decimal HWND), emitting
    /// each control then a snapshot_done per pass. Passes are spaced ≥1s apart
    /// (a benign re-render window) so the picker can diff for volatility.
    /// </summary>
    public static async Task RunAsync(
            string? target, int passes, JsonSerializerOptions opts, Action<string> emitLine) {
        var hwnd = ResolveTarget(target);
        AutomationElement? windowEl = null;
        try {
            if (hwnd != IntPtr.Zero) windowEl = AutomationElement.FromHandle(hwnd);
        } catch { windowEl = null; }

        if (windowEl == null) {
            emitLine(JsonSerializer.Serialize(new {
                v = 1, type = "warning",
                ts = DateTime.UtcNow.ToString("o"),
                msg = "snapshot: no target window",
                detail = $"target={target}",
            }, opts));
            emitLine(JsonSerializer.Serialize(new {
                v = 1, type = "snapshot_done",
                ts = DateTime.UtcNow.ToString("o"),
                data = new { window_title = (string?)null, count = 0, pass = 1 },
            }, opts));
            return;
        }

        passes = Math.Max(1, Math.Min(passes, 5));
        for (var pass = 1; pass <= passes; pass++) {
            // Wake any lazily-built (Chromium web) accessibility tree before
            // walking -- a browser window is UIA-dark until queried, so an
            // un-woken first walk would see only browser chrome (ADR-0025).
            WakeAccessibility(windowEl);

            var title = SafeName(windowEl);
            var controls = SnapshotWalker.Walk(new LiveSnapshotElement(windowEl), pass);
            foreach (var c in controls) {
                emitLine(JsonSerializer.Serialize(new {
                    v = 1, type = "snapshot_control",
                    ts = DateTime.UtcNow.ToString("o"),
                    data = c,
                }, opts));
            }
            emitLine(JsonSerializer.Serialize(new {
                v = 1, type = "snapshot_done",
                ts = DateTime.UtcNow.ToString("o"),
                data = new { window_title = title, count = controls.Count, pass },
            }, opts));

            if (pass < passes) await Task.Delay(1100).ConfigureAwait(false);
        }
    }

    private static IntPtr ResolveTarget(string? target) {
        if (string.IsNullOrWhiteSpace(target) ||
            string.Equals(target, "foreground", StringComparison.OrdinalIgnoreCase)) {
            try { return GetForegroundWindow(); } catch { return IntPtr.Zero; }
        }
        // A decimal HWND (the viewer can pass a specific window handle).
        if (long.TryParse(target, out var h)) return new IntPtr(h);
        return IntPtr.Zero;
    }

    // Best-effort: touch the window + its Document descendant so a Chromium
    // renderer flips accessibility on. Mirrors UiaSubscriber's wake logic but
    // scoped to the single target window. Failures are swallowed.
    private static void WakeAccessibility(AutomationElement windowEl) {
        try { _ = windowEl.Current.Name; } catch { }
        try {
            var doc = windowEl.FindFirst(TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
            if (doc != null) { try { _ = doc.Current.Name; } catch { } }
        } catch { }
    }

    private static string? SafeName(AutomationElement el) {
        try { return el.Current.Name; } catch { return null; }
    }
}

/// <summary>
/// Live ISnapshotElement over a UIA AutomationElement. Every property read is
/// guarded (a control going away mid-walk throws on access); children are
/// enumerated lazily over the ControlView walker, which yields depth as the
/// caller recurses.
/// </summary>
public sealed class LiveSnapshotElement : ISnapshotElement {
    private readonly AutomationElement _el;
    public LiveSnapshotElement(AutomationElement el) { _el = el; }

    public string? ControlType {
        get { try { return _el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", ""); } catch { return null; } }
    }
    public string? AutomationId { get { try { return _el.Current.AutomationId; } catch { return null; } } }
    public string? Name { get { try { return _el.Current.Name; } catch { return null; } } }
    public string? ClassName { get { try { return _el.Current.ClassName; } catch { return null; } } }
    public string? FrameworkId { get { try { return _el.Current.FrameworkId; } catch { return null; } } }
    public string? Role { get { try { return _el.Current.LocalizedControlType; } catch { return null; } } }

    public (int x, int y, int w, int h)? Bounds {
        get {
            try {
                var r = _el.Current.BoundingRectangle;
                if (r.IsEmpty || r.Width < 1 || r.Height < 1) return null;
                if (double.IsInfinity(r.X) || double.IsInfinity(r.Y) ||
                    double.IsInfinity(r.Width) || double.IsInfinity(r.Height)) return null;
                return ((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height);
            } catch { return null; }
        }
    }

    public IEnumerable<ISnapshotElement> Children {
        get {
            var walker = TreeWalker.ControlViewWalker;
            AutomationElement? child = null;
            try { child = walker.GetFirstChild(_el); } catch { yield break; }
            while (child != null) {
                yield return new LiveSnapshotElement(child);
                try { child = walker.GetNextSibling(child); } catch { yield break; }
            }
        }
    }
}
