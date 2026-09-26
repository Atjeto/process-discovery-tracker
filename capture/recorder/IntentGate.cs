// Whether the user acted on an element: the recorder keeps what the user
// did and leaves out what an application does by itself. The live
// recordings of 2026-09-26 (findings 3, 6, 11 and 13) showed the second
// kind drafted as work: a web screen filling its empty fields and its
// select's default option as it loads, the Office ribbon echoing the
// selected cell (Bold, Bottom Align, "Font: Aptos Narrow"), File Explorer's
// navigation pane announcing every pinned folder, drive and OneDrive name
// as it refreshes (names that must never be written), a desktop icon
// selected behind the windows, and Excel's formula AutoComplete list.
//
// The rule:
//   - a value change counts when its element has the keyboard focus, had it
//     within the last two seconds (Excel reports a cell's value as the Tab
//     moves the focus on), or holds the focused element (a combo box around
//     its edit or its open list);
//   - a selection or a toggle counts on the same terms, or when its element
//     lies inside a focused list, tree, table or tab strip (keys moving the
//     selection there), or when it is under the mouse pointer (a click that
//     moves no focus, like the ribbon's Bold);
//   - an invoke always counts: it is the user's click or key.
//
// An application that never reports the focus below its window (a custom
// drawn program, a remote session) cannot be judged this way: while it is
// the program in front, what it reports is kept, as before (ReportsFocus).
//
// Pure: element descriptors in, a decision out. The live UI Automation reads
// that build the descriptors are in UiaSubscriber; the rule is unit-tested
// with synthetic event sequences (Recorder.Tests/IntentGateTests).

using System;
using System.Collections.Generic;

namespace Pdt.Recorder;

/// <summary>What the gate compares of an element. <c>ControlType</c> is the
/// programmatic name without its "ControlType." prefix ("Edit", "ListItem");
/// <c>RuntimeId</c> is the UI Automation runtime id joined with "-".
/// <c>ClassName</c> is carried for the recorder (the address bar), not compared.</summary>
internal sealed record ElementInfo(int Pid, string? RuntimeId, string? AutomationId,
                                   string? Name, string? ControlType, string? ClassName = null);

internal sealed class IntentGate {
    /// <summary>How long an element keeps counting as focused after the focus left it.</summary>
    internal static readonly TimeSpan Recent = TimeSpan.FromSeconds(2);

    private const int HistorySize = 12;
    // An element this many levels above the focused one still "holds" it
    // (a combo box two levels above its open list's item).
    private const int HoldsFocusLevels = 2;
    // A focused list, tree or table this many levels above an item holds it.
    private const int ContainerLevels = 3;
    // A click lands on a label or an icon inside the control that reacts.
    private const int PointerLevels = 3;

    // Controls too broad to count as "holding" the focus or the pointer: every
    // field on a page is inside the Document, every control inside its window.
    private static readonly HashSet<string> Broad = new(StringComparer.Ordinal) {
        "Document", "Pane", "Window", "Group", "Custom",
    };

    // Containers whose items the keyboard selects while the container itself
    // holds the focus.
    private static readonly HashSet<string> ItemContainers = new(StringComparer.Ordinal) {
        "List", "Tree", "DataGrid", "Table", "Tab", "ComboBox",
    };

    // An entry's ancestors are read only when a rule needs them (a combo box
    // holding the focused item of its open list): reading them for every
    // focus change delayed the events behind it on UI Automation's one
    // callback thread, and a click that changes the page lost its element.
    private sealed class Entry {
        public ElementInfo El = null!;
        public Lazy<IReadOnlyList<ElementInfo>> Ancestors = NoAncestors;
        public DateTime Start;
        public DateTime? End;
    }

    private static readonly IReadOnlyList<ElementInfo> None = Array.Empty<ElementInfo>();
    private static readonly Lazy<IReadOnlyList<ElementInfo>> NoAncestors = new(() => None);

    private static Lazy<IReadOnlyList<ElementInfo>> LazyList(Func<IReadOnlyList<ElementInfo>>? read) =>
        read == null ? NoAncestors : new Lazy<IReadOnlyList<ElementInfo>>(() => {
            try { return read() ?? None; } catch { return None; }
        }, System.Threading.LazyThreadSafetyMode.ExecutionAndPublication);

    // A focus on the whole window says nothing about where the user works.
    private static readonly HashSet<string> WindowLevel = new(StringComparer.Ordinal) {
        "Pane", "Window",
    };

    private readonly object _lock = new();
    private readonly List<Entry> _history = new();   // oldest first
    private readonly HashSet<int> _reportingPids = new();

    /// <summary>
    /// The focus moved to <paramref name="el"/> at <paramref name="at"/>;
    /// <paramref name="ancestors"/> reads its nearest ancestors (nearest
    /// first) when a rule first needs them.
    /// </summary>
    public void NoteFocus(ElementInfo el, Func<IReadOnlyList<ElementInfo>>? ancestors, DateTime at) {
        var entry = new Entry { El = el, Ancestors = LazyList(ancestors), Start = at };
        lock (_lock) {
            if (_history.Count > 0 && _history[^1].End == null) _history[^1].End = at;
            _history.Add(entry);
            if (_history.Count > HistorySize) _history.RemoveAt(0);
            if (!string.IsNullOrEmpty(el.ControlType) && !WindowLevel.Contains(el.ControlType)) {
                _reportingPids.Add(el.Pid);
            }
        }
    }

    /// <summary>The focus moved to <paramref name="el"/>, its nearest ancestors known.</summary>
    public void NoteFocus(ElementInfo el, IReadOnlyList<ElementInfo>? ancestors, DateTime at) =>
        NoteFocus(el, () => ancestors ?? None, at);

    /// <summary>
    /// Whether the program has reported the focus on something inside its
    /// windows (a field, a cell, a document) at least once. One that never
    /// has cannot be judged by the focus.
    /// </summary>
    public bool ReportsFocus(int pid) {
        lock (_lock) { return _reportingPids.Contains(pid); }
    }

    /// <summary>The element the focus is on now, or null before the first focus change.</summary>
    public ElementInfo? CurrentFocus {
        get { lock (_lock) { return _history.Count > 0 && _history[^1].End == null ? _history[^1].El : null; } }
    }

    /// <summary>
    /// The whole value-change rule. The live reads are asked for only when
    /// the history cannot answer: <paramref name="liveFocus"/> (where UI
    /// Automation says the focus is now: a value can arrive before the focus
    /// event that explains it), <paramref name="inFront"/> (the element's
    /// program owns the foreground window) and <paramref name="isShell"/>
    /// (the program is the Windows shell, explorer.exe).
    /// </summary>
    public bool AcceptValue(ElementInfo el, DateTime at,
                            Func<(ElementInfo? focus, Func<IReadOnlyList<ElementInfo>> ancestors)> liveFocus,
                            Func<bool> inFront, Func<bool> isShell) {
        if (WasFocused(el, at)) return true;
        var (focus, focusAncestors) = liveFocus();
        if (focus != null && MatchesFocus(el, focus, focusAncestors)) return true;
        return CannotTell(el, inFront, isShell);
    }

    /// <summary>
    /// The whole toggle and selection rule: the value terms, or inside a
    /// focused list (<paramref name="elAncestors"/>), or under the mouse
    /// pointer (<paramref name="pointer"/>: the element hit and its ancestors).
    /// </summary>
    public bool AcceptClick(ElementInfo el, DateTime at,
                            Func<IReadOnlyList<ElementInfo>> elAncestors,
                            Func<(ElementInfo? hit, Func<IReadOnlyList<ElementInfo>> ancestors)> pointer,
                            Func<bool> inFront, Func<bool> isShell) {
        if (WasFocused(el, at)) return true;
        if (InsideFocusedContainer(elAncestors, at)) return true;
        var (hit, hitAncestors) = pointer();
        if (UnderPointer(el, hit, hitAncestors)) return true;
        return CannotTell(el, inFront, isShell);
    }

    // A program that has never reported the focus below its window (custom
    // drawn, remote) cannot be judged by it: while it is in front, what it
    // reports is kept, as before the gate. A program behind the others (the
    // desktop, a widget board) is never the user's work. The Windows shell
    // always reports its focus, and its navigation pane names the owner's
    // folders (live finding 3), so it never gets this benefit of the doubt.
    private bool CannotTell(ElementInfo el, Func<bool> inFront, Func<bool> isShell) =>
        !ReportsFocus(el.Pid) && !isShell() && inFront();

    /// <summary>
    /// The value-change rule: <paramref name="el"/> has the focus, had it
    /// within <see cref="Recent"/>, or holds the focused element.
    /// </summary>
    public bool WasFocused(ElementInfo el, DateTime at) {
        var recent = RecentEntries(at);
        // The element itself first: no ancestor is read when it matches.
        foreach (var e in recent) {
            if (Same(el, e.El)) return true;
        }
        if (IsBroad(el)) return false;
        foreach (var e in recent) {
            if (HoldsAmong(el, e.Ancestors.Value, HoldsFocusLevels)) return true;
        }
        return false;
    }

    /// <summary>
    /// A selection's element lies inside a focused (or just focused) list,
    /// tree, table, tab strip or combo box: <paramref name="elAncestors"/>
    /// reads its nearest ancestors, nearest first, only when such a
    /// container has the focus.
    /// </summary>
    public bool InsideFocusedContainer(Func<IReadOnlyList<ElementInfo>> elAncestors, DateTime at) {
        var containers = new List<ElementInfo>();
        foreach (var e in RecentEntries(at)) {
            if (e.El.ControlType != null && ItemContainers.Contains(e.El.ControlType)) containers.Add(e.El);
        }
        if (containers.Count == 0) return false;
        IReadOnlyList<ElementInfo> ancestors;
        try { ancestors = elAncestors() ?? None; } catch { return false; }
        for (var k = 0; k < ancestors.Count && k < ContainerLevels; k++) {
            foreach (var c in containers) {
                if (Same(ancestors[k], c)) return true;
            }
        }
        return false;
    }

    /// <summary>
    /// <paramref name="el"/> is the focused element <paramref name="focus"/>,
    /// the same control seen through a second provider, or a narrow control
    /// holding it (<paramref name="focusAncestors"/>, nearest first, read only
    /// when needed).
    /// </summary>
    public static bool MatchesFocus(ElementInfo el, ElementInfo focus, Func<IReadOnlyList<ElementInfo>> focusAncestors) {
        if (Same(el, focus)) return true;
        if (IsBroad(el)) return false;
        IReadOnlyList<ElementInfo> ancestors;
        try { ancestors = focusAncestors() ?? None; } catch { return false; }
        return HoldsAmong(el, ancestors, HoldsFocusLevels);
    }

    /// <summary>
    /// <paramref name="el"/> is the element under the mouse pointer, or a
    /// narrow control holding it (the button around the icon clicked).
    /// </summary>
    public static bool UnderPointer(ElementInfo el, ElementInfo? hit, Func<IReadOnlyList<ElementInfo>> hitAncestors) {
        if (hit == null) return false;
        if (Same(el, hit)) return true;
        if (IsBroad(el)) return false;
        IReadOnlyList<ElementInfo> ancestors;
        try { ancestors = hitAncestors() ?? None; } catch { return false; }
        return HoldsAmong(el, ancestors, PointerLevels);
    }

    private static bool HoldsAmong(ElementInfo el, IReadOnlyList<ElementInfo> ancestors, int levels) {
        for (var k = 0; k < ancestors.Count && k < levels; k++) {
            if (Same(el, ancestors[k])) return true;
        }
        return false;
    }

    // The entries focused within Recent of `at` (the current one always),
    // newest first. Entries end in order, so once one ended too long ago,
    // all older did.
    private List<Entry> RecentEntries(DateTime at) {
        var list = new List<Entry>();
        lock (_lock) {
            for (var i = _history.Count - 1; i >= 0; i--) {
                var e = _history[i];
                if (e.End != null && at - e.End.Value > Recent) break;
                list.Add(e);
            }
        }
        return list;
    }

    /// <summary>
    /// The same control: the same UI Automation runtime id, or the same
    /// developer id and type in one process, or (when one side has no id) the
    /// same type and label in one process. Chrome reports each focus twice, the
    /// second time without the field's id; a web field keeps its id.
    /// </summary>
    public static bool Same(ElementInfo a, ElementInfo b) {
        if (a.Pid != b.Pid) return false;
        if (!string.IsNullOrEmpty(a.RuntimeId) && a.RuntimeId == b.RuntimeId) return true;
        if (!string.IsNullOrEmpty(a.ControlType) && a.ControlType == b.ControlType) {
            if (!string.IsNullOrEmpty(a.AutomationId) && a.AutomationId == b.AutomationId) return true;
            if ((string.IsNullOrEmpty(a.AutomationId) || string.IsNullOrEmpty(b.AutomationId)) &&
                !string.IsNullOrEmpty(a.Name) && a.Name == b.Name) return true;
        }
        return false;
    }

    private static bool IsBroad(ElementInfo el) =>
        string.IsNullOrEmpty(el.ControlType) || Broad.Contains(el.ControlType);
}
