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
    // §11e OCR last rung. Non-null only when the session opted in (hello
    // ocr:true); null keeps the screen-capture + OCR path completely out of
    // an ordinary capture. See OcrBridge / ADR-0023.
    private readonly OcrBridge? _ocr;
    // The capture app's own exe (from hello's host_process). Interactions from
    // this process are PDT's OWN windows (operator panel / dialogs) and are
    // never emitted -- keeps the raw log free of self-capture.
    private readonly string? _hostProcess;
    private bool _started;

    // value_changed coalescer: per-element debouncer (ValueCoalescer, RP-24).
    // Key: "{pid}|{automation_id}" (falls back to name/class, then to the
    // UIA RuntimeId, when the AutomationId is missing). The window is the
    // hello cmd's debounce_ms; set once in the constructor.
    private readonly ValueCoalescer _values;

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
                         bool verbose = false, int debounceMs = 750, bool ocr = false,
                         string? hostProcess = null) {
        _opts = opts;
        _onEvent = onEvent;
        _verbose = verbose;
        _values = new ValueCoalescer(TimeSpan.FromMilliseconds(debounceMs > 0 ? debounceMs : 750), onEvent);
        // Bind the OCR engine once per session when opted in; an unavailable
        // language pack leaves the bridge present-but-inert (Available=false).
        _ocr = ocr ? new OcrBridge() : null;
        _hostProcess = string.IsNullOrWhiteSpace(hostProcess) ? null : hostProcess;
    }

    /// <summary>
    /// Whether an interaction's process is PDT's OWN app (the host) and so must
    /// not be recorded. Compared case-insensitively, ignoring a trailing ".exe"
    /// (all of PDT's Electron processes share the host exe). Empty/absent on
    /// either side -> not the host. Pure mirror of the drop in BuildEvent.
    /// </summary>
    internal static bool IsHostProcess(string? processName, string? hostProcess) {
        if (string.IsNullOrEmpty(processName) || string.IsNullOrEmpty(hostProcess)) return false;
        return StripExe(processName).Equals(StripExe(hostProcess), StringComparison.OrdinalIgnoreCase);
    }

    private static string StripExe(string s) {
        s = s.Trim();
        return s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? s[..^4] : s;
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
        _values.FlushAll();
        _started = false;
    }

    private void OnPropertyChanged(AutomationElement el, AutomationPropertyChangedEventArgs e) {
        if (e.Property == TogglePattern.ToggleStateProperty) {
            EmitFiltered("toggle_changed", el, new { toggle_state = e.NewValue?.ToString()?.ToLowerInvariant() });
        } else if (e.Property == ValuePattern.ValueProperty ||
                   e.Property == RangeValuePattern.ValueProperty) {
            // SECURITY (CRITICAL): a password / masked-secret control's value
            // must NEVER reach the immutable events.jsonl. Gate BEFORE reading
            // the value or running any recovery -- Windows already blanks a
            // password field's ValuePattern value, and the §11e TextPattern
            // recovery below would actively defeat that blanking. We emit the
            // interaction (the analyst still sees the secret field was filled)
            // with the value omitted and value_redacted:true. Range values are
            // numeric (slider/spinner), never secret, so they are exempt.
            bool isRange = e.Property == RangeValuePattern.ValueProperty;
            if (ShouldRedactValue(IsSecretValueElement(el), isRange)) {
                EmitValueChanged(el, value: null, truncated: false, valueSource: null, redacted: true);
                return;
            }
            var raw = e.NewValue?.ToString() ?? "";
            // Value-recovery (§11e): when the change signal carries an empty
            // value -- a rich-text / document control that fires the change
            // but exposes its text through TextPattern, not ValuePattern --
            // recover it via TextPattern. Generalizes the AG-Grid fix;
            // value_source flags that the text didn't come from ValuePattern.
            // Skipped entirely when raw is non-empty, so the common path adds
            // no UIA reads.
            string? valueSource = null;
            if (string.IsNullOrEmpty(raw)) {
                var (recovered, src) = RecoverValue(raw, TryReadTextValue(el), "text_pattern");
                if (recovered != null) { raw = recovered; valueSource = src; }
            }
            // Length-clamp text values (incl. a recovered one); range values
            // are short numerics. Flag the clamp so the analyst knows the
            // stored value is partial.
            var (v, truncated) = ClampValue(raw);
            EmitValueChanged(el, v, truncated, valueSource);
        }
    }

    private void EmitValueChanged(AutomationElement el, string? value, bool truncated,
                                  string? valueSource = null, bool redacted = false) {
        // value_truncated stays null (and is omitted) unless the clamp fired;
        // value_source stays null (omitted) unless recovery fired (§11e). A
        // redacted secret carries ONLY value_redacted:true -- never the value,
        // its length (value_truncated), or its recovery source -- so no
        // metadata about the password leaks into events.jsonl.
        object extra = redacted
            ? new { value_redacted = true }
            : new { value, value_truncated = truncated ? (bool?)true : null, value_source = valueSource };
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
        _values.Submit(key, built);
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

    /// <summary>
    /// Value-recovery selection (§11e) -- pure half of generalizing the
    /// AG-Grid fix. When a value-bearing control signals a change but its
    /// primary UIA ValuePattern value comes through empty (rich-text /
    /// document controls that expose their content through TextPattern, not
    /// ValuePattern), recover from a fallback candidate. Returns the value to
    /// emit plus a `value_source` tag, which is null on the normal path
    /// (primary value present) so the flag is only emitted when recovery
    /// actually fired -- mirroring the value_truncated convention. Never
    /// overrides a real primary value. The source label is passed in so new
    /// recovery rungs (e.g. "ocr") reuse this selection unchanged.
    /// </summary>
    internal static (string? value, string? source) RecoverValue(
            string? primaryValue, string? candidateValue, string candidateSource) {
        if (!string.IsNullOrEmpty(primaryValue)) return (primaryValue, null);
        if (!string.IsNullOrEmpty(candidateValue)) return (candidateValue, candidateSource);
        return (null, null);
    }

    // Safe read of an element's text content via TextPattern -- the managed
    // UIA recovery source for controls (Document, rich edit, some custom
    // grids) that expose their text through TextPattern but report an empty
    // ValuePattern value. Bounded by maxLen (the caller clamps to 256
    // anyway) so a whole-document read can't blow up. Guarded: an
    // unsupported pattern or a throwing range yields null, never an
    // exception on the interaction hot path.
    private static string? TryReadTextValue(AutomationElement el, int maxLen = 257) {
        try {
            if (el.TryGetCurrentPattern(TextPattern.Pattern, out var p) &&
                p is TextPattern tp) {
                var v = tp.DocumentRange.GetText(maxLen);
                return string.IsNullOrEmpty(v) ? null : v;
            }
        } catch { }
        return null;
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

    /// <summary>
    /// The identity-ladder rung for this element (§11e). UIA exposes
    /// several identifying properties of decreasing reliability; this
    /// reports which one actually gave the element a stable identity:
    ///   automation_id  developer-assigned, stable across runs/locale -- best
    ///   name           the visible label; meaningful but locale/content-dependent
    ///   class_name     shared across many controls; a weak identity at best
    ///   none           no structured identity -- the local-region OCR last
    ///                  resort applies (see ADR-0023 / the OCR bridge)
    /// Pure mirror of the corresponding field reads in BuildEvent.
    /// </summary>
    internal static string ResolveIdentitySource(string? automationId, string? name, string? className) {
        if (!string.IsNullOrEmpty(automationId)) return "automation_id";
        if (!string.IsNullOrEmpty(name)) return "name";
        if (!string.IsNullOrEmpty(className)) return "class_name";
        return "none";
    }

    /// <summary>
    /// Per-element capture confidence in [0,1] (§11e) -- how much the
    /// analyst should trust the captured identity. It blends the
    /// identity-ladder rung with the detected toolkit: a strong rung still
    /// earns low confidence on a `remote`/`terminal` surface, where even a
    /// present Name is usually the host window's, not the real control's.
    /// Pure; rounded to two decimals so tallies/means stay stable.
    /// </summary>
    internal static double ComputeConfidence(string identitySource, string? framework) {
        double conf = identitySource switch {
            "automation_id" => 0.95,
            "name"          => 0.70,
            "class_name"    => 0.40,
            "ocr"           => 0.25,   // a recovered label -- weak, but better than none
            _               => 0.10,   // "none"
        };
        // Remoted / terminal surfaces: the structured fields are unreliable
        // proxies for the real (pixel) control, so cap confidence low even
        // when a field is present. (A no-op for the ocr/none rungs, which
        // already sit below the cap.)
        if (framework == "remote" || framework == "terminal") {
            conf = Math.Min(conf, 0.30);
        }
        return Math.Round(conf, 2);
    }

    /// <summary>
    /// Whether the OCR last rung should fire for this element (§11e). The
    /// genuine last resort: only when OCR is enabled for the session, the
    /// element has NO structured identity (identity_source == "none"), and
    /// it has a usable on-screen bounding box to capture. This keeps the
    /// expensive screen-capture + OCR path off every element that already
    /// carries any identity at all. Pure.
    /// </summary>
    internal static bool ShouldOcr(string identitySource, bool hasBounds, bool ocrEnabled,
                                   bool isSecret = false) {
        // SECURITY (CRITICAL): never OCR a secret/password control's region --
        // defense in depth with the value-redaction gate, so even an
        // identityless password input (web <input type=password> with no
        // aid/name) never has its on-screen region captured.
        return ocrEnabled && !isSecret && identitySource == "none" && hasBounds;
    }

    /// <summary>
    /// SECURITY (CRITICAL): the value-redaction policy. A control's typed value
    /// must be redacted at capture -- never written to the immutable
    /// events.jsonl -- when UIA flags it <c>IsPassword</c>. Range values
    /// (slider / spinner) are numeric and never a secret, so they are exempt
    /// even if a control oddly reports IsPassword. Pure mirror of the gate in
    /// OnPropertyChanged so the policy is unit-pinned without a live UIA tree.
    /// </summary>
    internal static bool ShouldRedactValue(bool isPassword, bool isRangeValue) =>
        isPassword && !isRangeValue;

    /// <summary>
    /// SECURITY (CRITICAL): true when an element's value must never be
    /// persisted to the immutable events.jsonl -- a password / masked-secret
    /// control, as flagged by the UIA <c>IsPassword</c> property (set by every
    /// well-behaved password Edit on Win32/WinForms/WPF/WinUI and by
    /// <c>&lt;input type="password"&gt;</c> in Chromium). A throwing or absent
    /// property is treated as NOT secret: we cannot prove it is a password, and
    /// the normal value path is the safe-by-default pre-existing behaviour.
    /// IsPassword is the documented UIA contract for password fields, so it --
    /// not a brittle class-name heuristic -- is the gate.
    /// </summary>
    private static bool IsSecretValueElement(AutomationElement el) {
        try { return el.Current.IsPassword; }
        catch { return false; }
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
            // Never record PDT's OWN windows (operator panel / dialogs) as
            // interactions. Short-circuit before the OCR/coverage work below.
            if (IsHostProcess(data.TryGetValue("process_name", out var pnv) ? pnv as string : null,
                              _hostProcess)) {
                return null;
            }
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

            // E8 (§11e): the identity-ladder rung + a per-element capture-
            // confidence score. identity_source says which property gave the
            // element a stable identity (automation_id -> name -> class_name
            // -> none); confidence blends that rung with the toolkit so the
            // analyst can flag low-trust captures. A "none" rung at low
            // confidence is the OCR last-resort candidate.
            var identitySource = ResolveIdentitySource(
                data.TryGetValue("automation_id", out var aidV) ? aidV as string : null,
                data.TryGetValue("name", out var nmV) ? nmV as string : null,
                data.TryGetValue("class_name", out var clsV) ? clsV as string : null);

            // OCR last rung (§11e): an identityless element (no aid/name/
            // class) on an OCR-enabled session -- capture its on-screen
            // region and recover a text label. Default-off, so this whole
            // block is skipped unless the analyst opted in for a known
            // low-UIA app; bounded to identity_source=="none" so it never
            // touches an element that already has any identity. The
            // recovered text rides as `ocr_text` and lifts the rung to "ocr".
            var ocrReady = _ocr != null && _ocr.Available;
            var bounds = ocrReady ? TryGetBounds(el) : null;
            // SECURITY (CRITICAL): suppress the OCR rung on a secret/password
            // control. Evaluated only on an OCR-enabled session (the common
            // path reads no extra UIA property).
            var isSecret = ocrReady && IsSecretValueElement(el);
            if (ShouldOcr(identitySource, bounds.HasValue, ocrReady, isSecret)) {
                var b = bounds!.Value;
                var label = _ocr!.RecognizeScreenRegion(b.x, b.y, b.w, b.h);
                if (!string.IsNullOrEmpty(label)) {
                    var (clamped, _) = ClampValue(label);
                    data["ocr_text"] = clamped;
                    identitySource = "ocr";
                }
            }

            data["identity_source"] = identitySource;
            data["confidence"] = ComputeConfidence(identitySource, data["framework"] as string);

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

    // Best-effort read of an element's on-screen bounding box for the OCR
    // last rung. Null when UIA reports no / empty / off-screen (infinite)
    // rectangle -- there is nothing to capture. RecognizeScreenRegion
    // additionally bounds the size, so a bad box can't drive a huge grab.
    private static (int x, int y, int w, int h)? TryGetBounds(AutomationElement el) {
        try {
            var r = el.Current.BoundingRectangle;
            if (r.IsEmpty || r.Width < 1 || r.Height < 1) return null;
            if (double.IsInfinity(r.X) || double.IsInfinity(r.Y) ||
                double.IsInfinity(r.Width) || double.IsInfinity(r.Height)) return null;
            return ((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height);
        } catch {
            return null;
        }
    }
}
