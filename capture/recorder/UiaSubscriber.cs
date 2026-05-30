// Subscribes to UIA Invoked / SelectionItemSelected / TextChanged /
// FocusChanged / PropertyChanged events on the desktop root with
// TreeScope.Subtree. Resolves per-element fields safely (any field
// that throws on access is omitted).
//
// Noise filtering (default mode):
//   - focus_changed events are dropped. UIA fires them on every Tab
//     keypress, click-shift-focus, menu hover, dialog open/close. The
//     window_title / process_name semantics we care about ride along
//     on the next signal event, so we lose nothing analytical.
//   - text_changed events are dropped. The C# code already noted they
//     are "notification only, no payload" -- the actual value comes
//     from ValueProperty changes.
//   - value_changed / range_value_changed events are coalesced per
//     (pid, automation_id || name || runtime_id) within a debounce
//     window. Typing "Customer Acme Corp" emits one event with the
//     final value instead of one per keystroke.
//   - Events from low-signal control types (Pane, Group, Window with
//     framework_id == "Win32") are dropped -- these are desktop shell
//     / layout chrome, not user actions.
//   - Events from Chromium internal-DOM chrome (Pane/Group/Document/
//     Custom with framework_id == "Chrome" and no AutomationId) are
//     dropped -- browser and Electron render scaffolding, not user
//     actions. Real web-app controls keep their page-set AutomationId.
//
// Verbose mode (hello cmd carries `verbose: true`): skips all the
// above filters and emits the raw firehose. Reserved for forensic
// debugging of focus-tracking issues.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Windows.Automation;

namespace Pdt.Recorder;

public sealed class UiaSubscriber {
    private readonly JsonSerializerOptions _opts;
    private readonly Action<object> _onEvent;
    private readonly bool _verbose;
    private bool _started;

    // value_changed coalescer: per-element debouncer.
    // Key: "{pid}|{automation_id}" (falls back to name/class, then to the
    // UIA RuntimeId, when the AutomationId is missing).
    // Value: latest pending event + timer that fires after the debounce window.
    private readonly ConcurrentDictionary<string, PendingValue> _pending = new();
    // value_changed coalescing window. Configurable via the hello cmd's
    // debounce_ms field; set once in the constructor.
    private readonly TimeSpan _valueCoalesceWindow;

    // Control types whose UIA notifications are almost always layout
    // chrome rather than user action. Combined with Win32 framework
    // these are e.g. the taskbar, desktop window manager, AltTab list.
    private static readonly HashSet<string> LowSignalControlTypes = new(StringComparer.Ordinal) {
        "Pane", "Group", "Window", "Custom"
    };

    // Chromium render-tree scaffolding control types. Combined with the
    // "Chrome" framework and an empty AutomationId these are browser /
    // Electron internal DOM, not user actions.
    private static readonly HashSet<string> BrowserChromeControlTypes = new(StringComparer.Ordinal) {
        "Pane", "Group", "Document", "Custom"
    };

    // Health counters surfaced on the recorder stats line. _lastError is
    // a snapshot of the most recent BuildEvent failure.
    private long _errors;
    private volatile Dictionary<string, object?>? _lastError;

    // pids that have already emitted an event carrying a coverage_hint.
    private readonly ConcurrentDictionary<int, byte> _coveredPids = new();

    // Chromium accessibility wake-up. Chrome builds its accessibility
    // tree lazily; without an external query, web content fires no UIA
    // events and the recorder sees only the omnibox / browser chrome.
    // We touch the desktop tree on a ramped schedule -- a synchronous
    // first pass at Start(), then 250 ms ticks for 5 s (the window
    // during which Chrome can still be deciding whether to enable
    // accessibility), then settle to 1 s. Without the burst, a
    // short-session form-fill can fire BEFORE Chrome flips its
    // accessibility-on bit and the recorder produces no value_changed
    // events for the typed content. See ADR-0001 + CAPTURE.md.
    private Timer? _chromeWakeTimer;
    private DateTime _wakeStartedUtc;
    private const int WAKE_BURST_MS    = 250;
    private const int WAKE_BURST_SPAN_SECONDS = 5;
    private const int WAKE_SETTLE_MS   = 1000;
    // Cached OrCondition matching the family of Chromium-rendered top-
    // level windows. ClassNames vary across Chrome versions / Edge /
    // Electron host apps; we match what we know in production today.
    // Property is computed lazily to avoid touching UIA at construction.
    private static readonly Condition _chromiumWindowCondition = new OrCondition(
        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_0"),
        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_1"),
        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_2"),
        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_3"),
        // Edge legacy: ApplicationFrameWindow hosts modern Edge tabs
        new PropertyCondition(AutomationElement.ClassNameProperty, "ApplicationFrameWindow"),
        new PropertyCondition(AutomationElement.FrameworkIdProperty, "Chrome"));

    public UiaSubscriber(JsonSerializerOptions opts, Action<object> onEvent,
                         bool verbose = false, int debounceMs = 750) {
        _opts = opts;
        _onEvent = onEvent;
        _verbose = verbose;
        _valueCoalesceWindow = TimeSpan.FromMilliseconds(debounceMs > 0 ? debounceMs : 750);
    }

    /// <summary>Total BuildEvent failures since start (recorder stats line).</summary>
    public long ErrorCount => Interlocked.Read(ref _errors);

    /// <summary>Snapshot of the most recent BuildEvent failure, or null.</summary>
    public Dictionary<string, object?>? LastError => _lastError;

    public void Start() {
        if (_started) return;
        _started = true;
        var root = AutomationElement.RootElement;

        Automation.AddAutomationEventHandler(
            InvokePattern.InvokedEvent, root, TreeScope.Subtree,
            (s, e) => EmitFiltered("invoked", (AutomationElement)s, null));

        Automation.AddAutomationEventHandler(
            SelectionItemPattern.ElementSelectedEvent, root, TreeScope.Subtree,
            (s, e) => EmitFiltered("selection_changed", (AutomationElement)s,
                ExtractSelectionPayload((AutomationElement)s)));

        // Property-changed events for Toggle/Value/RangeValue
        Automation.AddAutomationPropertyChangedEventHandler(
            root, TreeScope.Subtree,
            (s, e) => OnPropertyChanged((AutomationElement)s, e),
            TogglePattern.ToggleStateProperty,
            ValuePattern.ValueProperty,
            RangeValuePattern.ValueProperty);

        if (_verbose) {
            // Forensic mode: include focus + text-change firehose.
            Automation.AddAutomationFocusChangedEventHandler(
                (s, e) => EmitFiltered("focus_changed", (AutomationElement)s, null));

            Automation.AddAutomationEventHandler(
                TextPattern.TextChangedEvent, root, TreeScope.Subtree,
                (s, e) => EmitFiltered("text_changed", (AutomationElement)s, null));
        }

        // Chromium accessibility wake-up. Wake synchronously NOW so any
        // existing Chrome window has its AXTree ready before the first
        // event we'd care about fires. Then start a ramped poller: 250
        // ms ticks for the first 5 s (catches windows opened after
        // session-start), then settle to 1 s.
        _wakeStartedUtc = DateTime.UtcNow;
        WakeChromiumAccessibility();
        _chromeWakeTimer = new Timer(_ => WakeTick(), null,
                                     dueTime: WAKE_BURST_MS,
                                     period: WAKE_BURST_MS);
    }

    private void WakeTick() {
        WakeChromiumAccessibility();
        // If the burst window has elapsed, settle the timer to the
        // longer interval. We replace the timer (cheap on .NET) so a
        // late-arriving Chrome window still gets touched, just less
        // aggressively.
        var elapsed = (DateTime.UtcNow - _wakeStartedUtc).TotalSeconds;
        if (elapsed >= WAKE_BURST_SPAN_SECONDS && _chromeWakeTimer != null) {
            try {
                _chromeWakeTimer.Change(WAKE_SETTLE_MS, WAKE_SETTLE_MS);
            } catch { }
        }
    }

    public void Stop() {
        if (!_started) return;
        // Wait for an in-flight WakeTick to finish before tearing down
        // event handlers, so we don't race a partial AutomationElement
        // walk against RemoveAllEventHandlers. Timer.Dispose(WaitHandle)
        // signals the handle once all pending callbacks have returned.
        if (_chromeWakeTimer != null) {
            try {
                using var done = new ManualResetEvent(false);
                _chromeWakeTimer.Dispose(done);
                done.WaitOne(500);
            } catch {
                try { _chromeWakeTimer.Dispose(); } catch { }
            }
            _chromeWakeTimer = null;
        }
        try { Automation.RemoveAllEventHandlers(); } catch { }
        // Flush anything still pending in the value coalescer so we
        // don't lose the last keystroke before shutdown.
        foreach (var key in new List<string>(_pending.Keys)) {
            if (_pending.TryRemove(key, out var pending)) {
                pending.Timer.Dispose();
                _onEvent(pending.Event);
            }
        }
        _started = false;
    }

    private void OnPropertyChanged(AutomationElement el, AutomationPropertyChangedEventArgs e) {
        if (e.Property == TogglePattern.ToggleStateProperty) {
            EmitFiltered("toggle_changed", el, new { toggle_state = e.NewValue?.ToString()?.ToLowerInvariant() });
        } else if (e.Property == ValuePattern.ValueProperty ||
                   e.Property == RangeValuePattern.ValueProperty) {
            var raw = e.NewValue?.ToString() ?? "";
            // Length-clamp text values; range values are short numerics.
            // Flag the clamp so the analyst knows the stored value is partial.
            var (v, truncated) = ClampValue(raw);
            EmitValueChanged(el, v, truncated);
        }
    }

    private void EmitValueChanged(AutomationElement el, string value, bool truncated) {
        // value_truncated stays null (and is omitted) unless the clamp fired.
        var extra = new { value, value_truncated = truncated ? (bool?)true : null };
        if (_verbose) {
            EmitFiltered("value_changed", el, extra);
            return;
        }
        var key = CoalesceKey(el);
        if (key == null) {
            // No stable identity -- emit immediately, no coalescing possible.
            EmitFiltered("value_changed", el, extra);
            return;
        }
        var built = BuildEvent("value_changed", el, extra);
        if (built == null) return;
        _pending.AddOrUpdate(key,
            // First entry for this key: schedule a flush.
            _ => new PendingValue { Event = built, Timer = NewTimer(key) },
            // Existing entry: replace the event, reset the timer.
            (_, existing) => {
                existing.Event = built;
                existing.Timer.Change(_valueCoalesceWindow, Timeout.InfiniteTimeSpan);
                return existing;
            });
    }

    private Timer NewTimer(string key) {
        return new Timer(_ => {
            if (_pending.TryRemove(key, out var pending)) {
                pending.Timer.Dispose();
                _onEvent(pending.Event);
            }
        }, null, _valueCoalesceWindow, Timeout.InfiniteTimeSpan);
    }

    /// <summary>
    /// Touch every Chromium top-level window's accessibility tree so
    /// Chrome flips into accessibility-on mode for that window. Chrome
    /// builds the AXTree on demand the first time something (a screen
    /// reader, a UIA tool) queries an interesting property on the
    /// window AND walks into the renderer's content. We do both, every
    /// tick, on EVERY Chromium top-level window we can see.
    ///
    /// Chromium top-level windows historically had ClassName
    /// "Chrome_WidgetWin_1"; on modern Win11 Chrome / Edge / Playwright
    /// Chromium they can be "Chrome_WidgetWin_2" or other variants, and
    /// some Electron app windows show up under different classes. We
    /// match the prefix "Chrome_" to cover the family, and we ALSO walk
    /// every top-level window whose FrameworkId is "Chrome" -- the most
    /// reliable signal that we're looking at a Chromium-rendered top-
    /// level window.
    ///
    /// We deliberately do NOT cache "woken" windows; each tick re-touches
    /// the AXTree so that a per-tab navigation can't silently drop us
    /// back to "accessibility-off". The cost is bounded (children of
    /// RootElement, filtered).
    /// </summary>
    private void WakeChromiumAccessibility() {
        try {
            var root = AutomationElement.RootElement;
            // Targeted query: only the known Chromium top-level window
            // classes + the FrameworkId=="Chrome" catch-all. Avoids
            // walking every top-level window on the desktop.
            var found = root.FindAll(TreeScope.Children, _chromiumWindowCondition);
            foreach (AutomationElement win in found) {
                // Reading any property triggers Chrome's accessibility
                // initialization. The combination of Name + ControlType
                // + a descendant walk for ControlType.Document mirrors
                // what an external accessibility tool would do.
                try { _ = win.Current.Name; } catch { }
                try { _ = win.Current.ControlType; } catch { }
                try { _ = win.Current.LocalizedControlType; } catch { }
                try {
                    var doc = win.FindFirst(TreeScope.Descendants,
                        new PropertyCondition(
                            AutomationElement.ControlTypeProperty,
                            ControlType.Document));
                    // Touching the document's Name lifts the renderer-
                    // side accessibility flag -- without this, the
                    // top-level query alone isn't always enough for
                    // freshly-launched Chromium builds (e.g. headed
                    // Playwright Chrome).
                    if (doc != null) {
                        try { _ = doc.Current.Name; } catch { }
                    }
                } catch { }
            }
        } catch {
            // Best-effort. If the desktop tree is in a transient bad
            // state (e.g., a window closing) we just retry next tick.
        }
    }

    private static string? CoalesceKey(AutomationElement el) {
        try {
            var pid = el.Current.ProcessId;
            var id = el.Current.AutomationId;
            var name = el.Current.Name;
            var cls = el.Current.ClassName;
            var rid = el.GetRuntimeId();
            return CoalesceKeyFromProps(pid, id, name, cls, rid);
        } catch {
            return null;
        }
    }

    /// <summary>
    /// Pure debounce-key derivation: prefer the AutomationId, then
    /// Name+ClassName, then the UIA RuntimeId, else null (no stable
    /// identity -> caller emits immediately, uncoalesced). Mirrors the
    /// property reads in CoalesceKey exactly.
    /// </summary>
    internal static string? CoalesceKeyFromProps(int pid, string? automationId,
                                                 string? name, string? className,
                                                 int[]? runtimeId) {
        if (!string.IsNullOrEmpty(automationId)) return $"{pid}|aid|{automationId}";
        if (!string.IsNullOrEmpty(name)) return $"{pid}|n|{name}|{className}";
        // Web content (Chrome) exposes an empty AutomationId *and* an
        // empty Name on input fields, so both keys above miss. The UIA
        // RuntimeId is stable for the element's lifetime -- which spans
        // a typing burst -- so it keys the debouncer well enough to
        // coalesce keystrokes into one final-value event.
        if (runtimeId != null && runtimeId.Length > 0) return $"{pid}|rid|{string.Join("-", runtimeId)}";
        return null;
    }

    private object? ExtractSelectionPayload(AutomationElement el) {
        try { return new { selected_value = el.Current.Name }; }
        catch { return null; }
    }

    /// <summary>
    /// Apply control-type / framework noise filters, then emit.
    /// In verbose mode the filter is a no-op.
    /// </summary>
    private void EmitFiltered(string kind, AutomationElement el, object? extra) {
        if (!_verbose && IsLowSignal(el)) return;
        var built = BuildEvent(kind, el, extra);
        if (built != null) _onEvent(built);
    }

    private static bool IsLowSignal(AutomationElement el) {
        try {
            var fwk = el.Current.FrameworkId;
            var ctl = el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
            var aid = el.Current.AutomationId;
            return IsLowSignalProps(fwk, ctl, aid, null);
        } catch {
            return false;
        }
    }

    /// <summary>
    /// Pure low-signal / browser-chrome decision over the property values
    /// IsLowSignal reads off the live element. <paramref name="controlType"/>
    /// is the ProgrammaticName with the "ControlType." prefix already
    /// stripped (e.g. "Pane"). <paramref name="name"/> is unused by the
    /// current rules; it is accepted to keep the seam stable.
    /// </summary>
    internal static bool IsLowSignalProps(string? frameworkId, string? controlType,
                                          string? automationId, string? name) {
        // Win32 desktop shell chrome (taskbar, window manager) fires
        // Pane/Group/Window/Custom notifications continuously. WPF /
        // WinForms / WinUI use the same control types but for real
        // application UI, so we only drop the Win32 case.
        if (string.Equals(frameworkId, "Win32", StringComparison.Ordinal)) {
            if (controlType != null && LowSignalControlTypes.Contains(controlType)) return true;
        }
        // Chromium render-tree scaffolding. Every browser -- and every
        // Electron app -- fires Pane/Group/Document/Custom events for
        // its own internal DOM. Real web-app controls carry a page-set
        // AutomationId, so an empty AutomationId keeps those while
        // dropping the noise.
        if (string.Equals(frameworkId, "Chrome", StringComparison.Ordinal) &&
            string.IsNullOrEmpty(automationId)) {
            if (controlType != null && BrowserChromeControlTypes.Contains(controlType)) return true;
        }
        return false;
    }

    /// <summary>
    /// Pure value-length clamp used for value_changed / range_value_changed
    /// payloads. Returns the (possibly truncated) value and whether the
    /// clamp fired. Mirrors the inline logic in OnPropertyChanged.
    /// </summary>
    internal static (string value, bool truncated) ClampValue(string raw, int max = 256) {
        if (raw.Length > max) return (raw.Substring(0, max), true);
        return (raw, false);
    }

    // Citrix / RDP / VMware remoting hosts present the remote session as a
    // single host window on the local desktop; UIA sees only that host (the
    // real controls are pixels inside it). Detecting the host class is the
    // signal behind the §11e deployment rule: run the recorder INSIDE the
    // session, and lean on the video backstop. Kept deliberately small and
    // grounded in documented class names -- live-remoting validation is
    // deferred (needs a Citrix/RDP session), so we do not guess broader.
    private static readonly string[] RemoteHostMarkers = {
        "wfica",                  // Citrix ICA client (wfica32.exe) windows
        "TscShellContainerClass", // mstsc.exe (RDP) top-level window
        "RAIL_",                  // RDP RemoteApp seamless windows
    };

    // Console / terminal hosts expose only a character grid to UIA -- no
    // structured controls. Flagging them tells the analyst structured
    // capture won't work here (the value/identity ladders will bottom out).
    private static readonly string[] TerminalClassMarkers = {
        "ConsoleWindowClass",            // classic conhost.exe
        "CASCADIA_HOSTING_WINDOW_CLASS", // Windows Terminal
        "VirtualConsoleClass",           // ConEmu
        "PuTTY",                         // PuTTY
        "mintty",                        // Git Bash / Cygwin
    };

    /// <summary>
    /// Normalized UI-toolkit taxonomy emitted as the interaction's
    /// <c>framework</c> field (§11e desktop-coverage hardening). This is
    /// distinct from two other things it is easy to confuse it with:
    ///   * the raw UIA <c>framework_id</c> -- which Java, Qt and remoting
    ///     hosts routinely misreport as "Win32"/empty, the exact gap this
    ///     closes; and
    ///   * the recognition layer's *web-app* <c>framework</c> axis
    ///     (chromium/ag-grid/office365), derived from class-name signatures
    ///     downstream.
    /// Knowing the real toolkit is how the analyst explains thin coverage:
    /// a Java Swing window needs the Java Access Bridge enabled; a Citrix
    /// host window is pixels (video backstop); a terminal is a text grid.
    /// Class-name signatures are checked before the FrameworkId because the
    /// toolkits that lie about their FrameworkId are exactly the ones whose
    /// window class is the reliable tell. The class names matched here are
    /// platform-stable constants (SunAwt*, Glass*, Qt*QWindow*,
    /// WindowsForms10.*, ConsoleWindowClass) -- the same category as the
    /// recorder's existing Chrome_WidgetWin_* match -- not app-specific ids.
    /// </summary>
    internal static string DetectFramework(string? frameworkId, string? className) {
        var fwk = frameworkId ?? "";
        var cls = className ?? "";

        // 1. Class-name signatures first (toolkits that misreport FrameworkId).
        if (cls.StartsWith("SunAwt", StringComparison.Ordinal)) return "java";    // AWT/Swing
        if (cls.StartsWith("GlassWnd", StringComparison.Ordinal) ||
            cls.StartsWith("Glass_", StringComparison.Ordinal)) return "javafx";
        if (IsQtClass(cls)) return "qt";
        if (ContainsAny(cls, RemoteHostMarkers)) return "remote";                 // Citrix/RDP/VMware
        if (ContainsAny(cls, TerminalClassMarkers)) return "terminal";
        if (cls.StartsWith("WindowsForms10.", StringComparison.Ordinal)) return "winforms";

        // 2. Trust the FrameworkId for toolkits that report it honestly.
        switch (fwk) {
            case "Chrome":   return "chromium";  // browsers AND Electron (chromium-hosted)
            case "WPF":      return "wpf";
            case "WinForm":
            case "WinForms": return "winforms";
            case "XAML":     return "winui";     // UWP / WinUI / XAML islands
            case "Win32":
            case "DirectUI": return "win32";
        }

        // 3. An unmapped-but-present FrameworkId is passed through lowercased
        //    so a future toolkit (e.g. "MAUI") stays visible; no signal at
        //    all -> "unknown".
        if (!string.IsNullOrEmpty(fwk)) return fwk.ToLowerInvariant();
        return "unknown";
    }

    // Qt top-level windows use a class like "Qt5152QWindowIcon" /
    // "Qt672QWindowIcon" (Qt<version>QWindowIcon), or the bare
    // "QWidget"/"QWindow" classes on older/embedded builds.
    private static bool IsQtClass(string cls) {
        if (cls.Length == 0) return false;
        if (cls == "QWidget" || cls == "QWindow") return true;
        return cls.StartsWith("Qt", StringComparison.Ordinal) &&
               cls.Contains("QWindow", StringComparison.Ordinal);
    }

    private static bool ContainsAny(string cls, string[] markers) {
        if (cls.Length == 0) return false;
        foreach (var m in markers) {
            if (cls.Contains(m, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private object? BuildEvent(string kind, AutomationElement el, object? extra) {
        try {
            var data = new Dictionary<string, object?> { ["kind"] = kind };
            TrySet(data, "control_type", () => el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", ""));
            TrySet(data, "automation_id", () => el.Current.AutomationId);
            TrySet(data, "name", () => el.Current.Name);
            TrySet(data, "class_name", () => el.Current.ClassName);
            TrySet(data, "framework_id", () => el.Current.FrameworkId);
            TrySet(data, "window_title", () => GetTopWindowTitle(el));
            TrySet(data, "process_name", () => GetProcessName(el));
            TrySet(data, "pid", () => el.Current.ProcessId);
            if (extra is not null) {
                var json = JsonSerializer.SerializeToElement(extra, _opts);
                foreach (var prop in json.EnumerateObject()) {
                    data[prop.Name] = prop.Value.ValueKind switch {
                        JsonValueKind.String => prop.Value.GetString(),
                        JsonValueKind.Number => prop.Value.TryGetInt64(out var l) ? (object)l : prop.Value.GetDouble(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        JsonValueKind.Null => null,
                        _ => prop.Value.ToString(),
                    };
                }
            }
            // E8 (§11e): normalized UI-toolkit detection from the raw
            // framework_id + class_name we just captured. Always present
            // (worst case "unknown") so the analyst can tally toolkit
            // coverage per app and explain thin capture (java/qt/remote/
            // terminal expose little to UIA). See DetectFramework.
            data["framework"] = DetectFramework(
                data.TryGetValue("framework_id", out var fwv) ? fwv as string : null,
                data.TryGetValue("class_name", out var clv) ? clv as string : null);

            // E6: the first event emitted for a pid carries a coverage
            // hint -- how richly UIA exposes that app. rich = a stable
            // AutomationId, basic = a control type only, minimal = just a
            // class name.
            TrySetCoverageHint(data);
            return new {
                v = 1, type = "interaction",
                ts = DateTime.UtcNow.ToString("o"),
                data,
            };
        } catch (Exception ex) {
            Interlocked.Increment(ref _errors);
            _lastError = BuildErrorInfo(kind, el, ex);
            Console.Error.WriteLine($"build event failed: {ex.Message}");
            return null;
        }
    }

    private static void TrySet<T>(IDictionary<string, object?> d, string key, Func<T> get) {
        try { var v = get(); if (v is not null) d[key] = v; } catch { }
    }

    // First event per pid gets a coverage_hint describing how richly UIA
    // exposes that app -- a signal the analyst can use to spot apps that
    // need a richer integration. Marks the pid so later events skip it.
    private void TrySetCoverageHint(Dictionary<string, object?> data) {
        if (!data.TryGetValue("pid", out var pidObj) || pidObj is not int pid) return;
        if (!_coveredPids.TryAdd(pid, 0)) return;
        var aid = data.TryGetValue("automation_id", out var aidV) ? aidV as string : null;
        string? hint;
        if (!string.IsNullOrEmpty(aid)) hint = "rich";
        else if (data.ContainsKey("control_type")) hint = "basic";
        else if (data.ContainsKey("class_name")) hint = "minimal";
        else hint = null;
        if (hint != null) data["coverage_hint"] = hint;
    }

    // Snapshot of the element that caused a BuildEvent failure, for the
    // recorder stats line. Each property read is guarded -- the element
    // is often throwing precisely because it is no longer available.
    private static Dictionary<string, object?> BuildErrorInfo(
            string kind, AutomationElement el, Exception ex) {
        var info = new Dictionary<string, object?> {
            ["kind"] = kind,
            ["message"] = ex.Message,
        };
        try { info["pid"] = el.Current.ProcessId; } catch { }
        try { info["process_name"] = GetProcessName(el); } catch { }
        try {
            info["control_type"] = el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
        } catch { }
        return info;
    }

    private static string? GetTopWindowTitle(AutomationElement el) {
        var walker = TreeWalker.ControlViewWalker;
        var node = el;
        AutomationElement? top = null;
        while (node != null && node != AutomationElement.RootElement) {
            top = node;
            node = walker.GetParent(node);
        }
        return top?.Current.Name;
    }

    private static string? GetProcessName(AutomationElement el) {
        try {
            var pid = el.Current.ProcessId;
            using var p = System.Diagnostics.Process.GetProcessById(pid);
            return p.ProcessName + ".exe";
        } catch { return null; }
    }

    private sealed class PendingValue {
        public object Event = null!;
        public Timer Timer = null!;
    }
}
