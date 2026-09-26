// Subscribes to UIA Invoked / SelectionItemSelected / TextChanged /
// FocusChanged / PropertyChanged events on the desktop root with
// TreeScope.Subtree. Resolves per-element fields safely (any field
// that throws on access is omitted).
//
// Noise filtering (default mode):
//   - focus_changed events are not written. UIA fires them on every Tab
//     keypress, click-shift-focus, menu hover, dialog open/close. The
//     window_title / process_name semantics we care about ride along
//     on the next signal event, so we lose nothing analytical. They are
//     still followed: the focus is what tells the user's work from what
//     an application does by itself (below).
//   - text_changed events are dropped. The C# code already noted they
//     are "notification only, no payload" -- the actual value comes
//     from ValueProperty changes.
//   - What the user acted on is told from what a program does by itself
//     (IntentGate, lane LF-SME): a value change on the focused element (or
//     one focused within two seconds), a selection or toggle there or under
//     the mouse pointer, and every invoke are the user's. The rest (a screen
//     filling its fields as it loads, the Office ribbon echoing the selected
//     cell) is written with "user_acted": false, and the pipeline leaves it
//     out of the steps: the gate only marks, so a program it misjudges loses
//     nothing (the owner, 2026-09-26). The Windows shell is the exception:
//     what it does by itself (File Explorer's navigation pane naming every
//     folder as it refreshes, a desktop icon selected behind the windows)
//     is never written.
//   - value_changed / range_value_changed events are coalesced per
//     (pid, automation_id || name || runtime_id) within a debounce
//     window. Typing "Customer Acme Corp" emits one event with the
//     final value instead of one per keystroke. An empty value is not
//     written (an empty web field reads back as U+FFFC), and a click
//     first writes the values still waiting, so the order is the user's.
//   - A choice in a drop-down list is written once, as the combo box's
//     value; the browser's address bar is written once per address.
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

    // What the user acted on (IntentGate): the focus history, fed by the
    // focus-changed handler, which runs in every mode. UI Automation calls
    // every handler on one thread, one event after another, so the handler
    // only queues the focused element: a thread of its own reads it. Read on
    // that one thread, a focus change delayed the click right behind it, and a
    // button that changes the page was gone before the click was read.
    private readonly IntentGate _intent = new();
    private readonly BlockingCollection<(AutomationElement el, DateTime at)> _focusQueue = new(boundedCapacity: 512);
    private Thread? _focusThread;

    // Typing seen (a value accepted into the coalescer), told to the capture
    // app at most every ActivityEveryMs per process: its "clicks and typing
    // are not being recorded" check counts typing that has not been written
    // yet. Null when the host does not listen.
    private readonly Action<string>? _onActivity;
    private readonly ConcurrentDictionary<int, long> _activityAt = new();
    private readonly ConcurrentDictionary<int, string?> _processNames = new();
    private const long ActivityEveryMs = 2000;

    // The browser's address bar (Chromium's omnibox in Chrome and Edge, by
    // its class, which is not translated): one event per address, never the
    // keystrokes. Its values wait under a "nav|" key while the bar holds the
    // focus (the user typing), and a click does not flush them.
    private const string AddressBarClass = "OmniboxViewViews";
    private const string NavKeyPrefix = "nav|";
    // A value the program changed by itself coalesces under a key of its
    // own, so it never replaces the user's value of the same field.
    private const string AppKeyPrefix = "app|";
    private readonly ConcurrentDictionary<string, ElementInfo> _navFields = new();

    // Written values per coalescing key, read and written only inside the
    // coalescer's lock (EmitOut): the same value for the same field within
    // SameValueWindow is one change reported twice (a drop-down reports its
    // choice as the combo's value and again as its option's selection); the
    // address bar is written once per address.
    private readonly Dictionary<string, (string? value, DateTime at)> _lastValues = new();
    private static readonly TimeSpan SameValueWindow = TimeSpan.FromSeconds(3);

    // A click reported twice by the provider (Character Map's Search, 5 ms
    // apart) is written once.
    private readonly object _clickLock = new();
    private (string kind, ElementInfo el, DateTime at)? _lastClick;
    private static readonly TimeSpan RepeatClickWindow = TimeSpan.FromMilliseconds(50);

    // What UI Automation fetches with every event (the cache request of the
    // handlers, Start), so an element gone by the time its event is read
    // still says what it was.
    private static readonly AutomationProperty[] CachedProperties = {
        AutomationElement.ControlTypeProperty,
        AutomationElement.AutomationIdProperty,
        AutomationElement.NameProperty,
        AutomationElement.ClassNameProperty,
        AutomationElement.FrameworkIdProperty,
        AutomationElement.ProcessIdProperty,
        AutomationElement.IsPasswordProperty,
    };

    // The element under the pointer, kept for a moment: a burst of echoes
    // (the ribbon's toggles) asks once.
    private readonly object _pointerLock = new();
    private (int x, int y, long at, ElementInfo? hit, Lazy<IReadOnlyList<ElementInfo>> ancestors)? _pointer;
    private const long PointerReuseMs = 300;

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
                         string? hostProcess = null, Action<string>? onActivity = null) {
        _opts = opts;
        _onEvent = onEvent;
        _verbose = verbose;
        _onActivity = onActivity;
        // Every event leaves through the coalescer (EmitOut), in order.
        _values = new ValueCoalescer(TimeSpan.FromMilliseconds(debounceMs > 0 ? debounceMs : 750),
                                     EmitOut, HoldAddressBar);
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

        // The properties the recorder reads, fetched by UI Automation as it
        // raises each event (the cache request active while the handlers are
        // added travels with them): a button whose click changes the page is
        // gone a few milliseconds later, and its name, id and program read
        // live were lost (live finding 2). Read() takes the cached value first.
        var cache = new CacheRequest();
        foreach (var p in CachedProperties) cache.Add(p);
        _focusThread = new Thread(FocusLoop) { IsBackground = true, Name = "pdt-focus" };
        _focusThread.Start();
        using (cache.Activate()) {
            Automation.AddAutomationEventHandler(
                InvokePattern.InvokedEvent, root, TreeScope.Subtree,
                (s, e) => OnClickLike("invoked", (AutomationElement)s, null));

            Automation.AddAutomationEventHandler(
                SelectionItemPattern.ElementSelectedEvent, root, TreeScope.Subtree,
                (s, e) => OnSelection((AutomationElement)s));

            // Property-changed events for Toggle/Value/RangeValue
            Automation.AddAutomationPropertyChangedEventHandler(
                root, TreeScope.Subtree,
                (s, e) => OnPropertyChanged((AutomationElement)s, e),
                TogglePattern.ToggleStateProperty,
                ValuePattern.ValueProperty,
                RangeValuePattern.ValueProperty);

            // The focus, in every mode: what the user acts on (IntentGate).
            // Forensic mode also writes it as focus_changed.
            Automation.AddAutomationFocusChangedEventHandler(
                (s, e) => OnFocusChanged((AutomationElement)s));

            if (_verbose) {
                // Forensic mode: include the text-change firehose.
                Automation.AddAutomationEventHandler(
                    TextPattern.TextChangedEvent, root, TreeScope.Subtree,
                    (s, e) => EmitFiltered("text_changed", (AutomationElement)s, null));
            }
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
        _focusQueue.CompleteAdding();
        try { _focusThread?.Join(500); } catch { }
        // Flush anything still pending in the value coalescer so we
        // don't lose the last keystroke before shutdown.
        _values.FlushAll();
        _started = false;
    }

    private void OnPropertyChanged(AutomationElement el, AutomationPropertyChangedEventArgs e) {
        if (e.Property == TogglePattern.ToggleStateProperty) {
            // on | off | indeterminate (SCHEMA): NewValue is the ToggleState
            // number, and some providers (Character Map's check box) send none,
            // so the pattern is read then.
            var state = ToggleStateName(e.NewValue) ?? ReadToggleState(el);
            OnClickLike("toggle_changed", el, new { toggle_state = state });
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
            var raw = CleanValue(e.NewValue?.ToString());
            // Value-recovery (§11e): when the change signal carries an empty
            // value -- a rich-text / document control that fires the change
            // but exposes its text through TextPattern, not ValuePattern --
            // recover it via TextPattern. Generalizes the AG-Grid fix;
            // value_source flags that the text didn't come from ValuePattern.
            // Skipped entirely when raw is non-empty, so the common path adds
            // no UIA reads.
            string? valueSource = null;
            if (raw.Length == 0) {
                var (recovered, src) = RecoverValue(raw, TryReadTextValue(el), "text_pattern");
                if (recovered != null) { raw = recovered; valueSource = src; }
            }
            // An empty value is not typed work (live finding 4): a screen
            // renders its empty fields, and an empty web input reads back as
            // U+FFFC through TextPattern. No value event for it.
            if (raw.Length == 0) return;
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
        try {
            var built = BuildEvent("value_changed", el, extra);
            if (built == null) return;
            var info = InfoOf(built.Data, el);
            if (info == null) return;
            // The address bar changes as a page navigates, while the user is
            // somewhere else: kept once per address (live finding 25). Any
            // other field counts only when the user worked in it (IntentGate).
            var addressBar = info.ClassName == AddressBarClass;
            var outcome = Outcome(addressBar || UserActedOnValue(el, info), IsShell(info.Pid));
            if (outcome == GateOutcome.Drop) return;
            if (outcome == GateOutcome.Mark) built.Data["user_acted"] = false;
            var key = CoalesceKeyOf(info);
            if (outcome == GateOutcome.Keep) NoteActivity(info);
            if (key == null) {
                // No stable identity: emit immediately, no coalescing possible.
                _values.Emit(built);
                return;
            }
            if (addressBar) {
                key = NavKeyPrefix + key;
                _navFields[key] = info;
            } else if (outcome == GateOutcome.Mark) {
                key = AppKeyPrefix + key;
            }
            built.CoalesceKey = key;
            _values.Submit(key, built);
        } catch (Exception ex) {
            NoteError("value_changed", el, ex);
        }
    }

    // ---- What the user acted on (IntentGate) ------------------------------

    private void OnFocusChanged(AutomationElement el) {
        var at = DateTime.UtcNow;
        try { if (_verbose) EmitFiltered("focus_changed", el, null); } catch { }
        // Queued, read on the focus thread (a full queue drops this change:
        // the next one says where the focus is).
        try { _focusQueue.TryAdd((el, at)); } catch { /* stopping */ }
    }

    private void FocusLoop() {
        try {
            foreach (var (el, at) in _focusQueue.GetConsumingEnumerable()) {
                try {
                    var info = Describe(el);
                    if (info != null) _intent.NoteFocus(info, () => AncestorsOf(el, 2), at);
                } catch { /* an element gone mid-read: the next focus change says where it is */ }
            }
        } catch { /* the queue was disposed while stopping */ }
    }

    /// <summary>
    /// An invoke, a toggle or a selection. An invoke is always the user's (a
    /// click or a key); a toggle or a selection counts only where the user
    /// acted (IntentGate). Values typed before it are written first.
    /// </summary>
    private void OnClickLike(string kind, AutomationElement el, object? extra) {
        try {
            if (_verbose) { EmitFiltered(kind, el, extra); return; }
            if (IsLowSignal(el)) return;
            // Read the element first and at once: a click that changes the
            // page replaces it within milliseconds (live finding 2).
            var built = BuildEvent(kind, el, extra);
            if (built == null) return;
            ClickLikeBuilt(kind, el, built);
        } catch (Exception ex) {
            NoteError(kind, el, ex);
        }
    }

    // The gate, the repeat check and the write, for an event already read.
    private void ClickLikeBuilt(string kind, AutomationElement el, InteractionLine built) {
        var info = InfoOf(built.Data, el);
        var outcome = GateOutcome.Keep;
        if (kind != "invoked") {
            if (info == null) return;
            outcome = Outcome(UserActedOnClick(el, info), IsShell(info.Pid));
            if (outcome == GateOutcome.Drop) return;
            if (outcome == GateOutcome.Mark) built.Data["user_acted"] = false;
        }
        // Only the user's clicks are compared for a repeat: a program's own
        // selection must not hide the user's click on the same control.
        if (outcome == GateOutcome.Keep && info != null && IsRepeatClick(kind, info)) return;
        _values.EmitAfterFlush(k => !k.StartsWith(NavKeyPrefix, StringComparison.Ordinal), built);
    }

    /// <summary>What the gate's answer does to an event.</summary>
    internal enum GateOutcome { Keep, Mark, Drop }

    /// <summary>
    /// The user's act is kept; a program's own change is marked
    /// ("user_acted": false) and the pipeline leaves it out of the steps;
    /// the Windows shell's own changes are never written (its navigation
    /// pane names the folders).
    /// </summary>
    internal static GateOutcome Outcome(bool userActed, bool isShell) =>
        userActed ? GateOutcome.Keep : isShell ? GateOutcome.Drop : GateOutcome.Mark;

    /// <summary>
    /// A selection. A choice in a drop-down list (an item inside a combo
    /// box) is the combo box's value, written once with the combo box as the
    /// field (live finding 7); any other selection is click-like.
    /// </summary>
    private void OnSelection(AutomationElement el) {
        if (_verbose) { EmitFiltered("selection_changed", el, ExtractSelectionPayload(el)); return; }
        try {
            if (IsLowSignal(el)) return;
            var built = BuildEvent("selection_changed", el, ExtractSelectionPayload(el));
            if (built == null) return;
            var combo = ComboBoxAround(el);
            if (combo != null) {
                var option = built.Data.TryGetValue("name", out var n) ? n as string : null;
                var clean = CleanValue(option);
                if (clean.Length == 0) return;
                var (v, truncated) = ClampValue(clean);
                EmitValueChanged(combo, v, truncated);
                return;
            }
            ClickLikeBuilt("selection_changed", el, built);
        } catch (Exception ex) {
            NoteError("selection_changed", el, ex);
        }
    }

    /// <summary>
    /// The gate's descriptor from an event already read (its data), plus the
    /// runtime id when the element is still there. An element whose process
    /// can no longer be read (Excel's cell right after a paste reports its id
    /// and value, and nothing else) is taken to be in the program in front,
    /// for the gate only (the event is written without a pid); null when
    /// there is none.
    /// </summary>
    private static ElementInfo? InfoOf(Dictionary<string, object?> data, AutomationElement el) {
        int pid;
        if (data.TryGetValue("pid", out var p) && p is int readPid) pid = readPid;
        else if (NativeMethods.ForegroundProcessId() is int front) pid = front;
        else return null;
        string? rid = null;
        try {
            var r = el.GetRuntimeId();
            if (r != null && r.Length > 0) rid = string.Join("-", r);
        } catch { }
        string? Str(string key) => data.TryGetValue(key, out var v) ? v as string : null;
        return new ElementInfo(pid, rid, Str("automation_id"), Str("name"), Str("control_type"), Str("class_name"));
    }

    /// <summary>A value change counts when its field has, or just had, the focus (IntentGate.AcceptValue).</summary>
    private bool UserActedOnValue(AutomationElement el, ElementInfo info) =>
        _intent.AcceptValue(info, DateTime.UtcNow, LiveFocus,
            () => NativeMethods.IsForegroundProcess(info.Pid), () => IsShell(info.Pid));

    /// <summary>
    /// A toggle or a selection counts on the value terms, inside a focused
    /// list, or under the mouse pointer (a click that moves no focus, like
    /// the Office ribbon's Bold). IntentGate.AcceptClick.
    /// </summary>
    private bool UserActedOnClick(AutomationElement el, ElementInfo info) =>
        _intent.AcceptClick(info, DateTime.UtcNow, () => AncestorsOf(el, 3), PointerHit,
            () => NativeMethods.IsForegroundProcess(info.Pid), () => IsShell(info.Pid));

    private static readonly Func<IReadOnlyList<ElementInfo>> NoAncestors = () => Array.Empty<ElementInfo>();

    private static (ElementInfo? focus, Func<IReadOnlyList<ElementInfo>> ancestors) LiveFocus() {
        try {
            var focused = AutomationElement.FocusedElement;
            var f = Describe(focused);
            return f == null ? (null, NoAncestors) : (f, () => AncestorsOf(focused, 2));
        } catch {
            return (null, NoAncestors);
        }
    }

    private bool IsShell(int pid) =>
        string.Equals(ProcessNameOf(pid), "explorer.exe", StringComparison.OrdinalIgnoreCase);

    private string? ProcessNameOf(int pid) =>
        _processNames.GetOrAdd(pid, p => {
            try {
                using var proc = System.Diagnostics.Process.GetProcessById(p);
                return proc.ProcessName + ".exe";
            } catch { return null; }
        });

    /// <summary>
    /// The element under the mouse pointer, and a reader of its nearest
    /// ancestors used only when needed (both kept for PointerReuseMs).
    /// </summary>
    private (ElementInfo? hit, Func<IReadOnlyList<ElementInfo>> ancestors) PointerHit() {
        if (!NativeMethods.GetCursorPos(out var p)) return (null, NoAncestors);
        var now = Environment.TickCount64;
        lock (_pointerLock) {
            if (_pointer is { } c && c.x == p.X && c.y == p.Y && now - c.at < PointerReuseMs) {
                return (c.hit, () => c.ancestors.Value);
            }
        }
        ElementInfo? hit = null;
        AutomationElement? el = null;
        try {
            el = AutomationElement.FromPoint(new System.Windows.Point(p.X, p.Y));
            hit = Describe(el);
        } catch { }
        var hitEl = el;
        var ancestors = new Lazy<IReadOnlyList<ElementInfo>>(
            () => hitEl == null ? Array.Empty<ElementInfo>() : AncestorsOf(hitEl, 3));
        lock (_pointerLock) { _pointer = (p.X, p.Y, now, hit, ancestors); }
        return (hit, () => ancestors.Value);
    }

    /// <summary>What IntentGate compares of an element, or null when it cannot be read.</summary>
    private static ElementInfo? Describe(AutomationElement? el) {
        if (el == null) return null;
        int pid;
        try { pid = Read(el, i => i.ProcessId); } catch { return null; }
        string? rid = null;
        try {
            var r = el.GetRuntimeId();
            if (r != null && r.Length > 0) rid = string.Join("-", r);
        } catch { }
        string? aid = null, name = null, type = null;
        try { aid = Read(el, i => i.AutomationId); } catch { }
        try { name = Read(el, i => i.Name); } catch { }
        try { type = ControlTypeName(el); } catch { }
        return new ElementInfo(pid, rid, aid, name, type);
    }

    /// <summary>
    /// One property of an element: the value UI Automation cached as it raised
    /// the event (CachedProperties), else a live read, which throws when the
    /// element is gone (callers omit the field then).
    /// </summary>
    private static T Read<T>(AutomationElement el, Func<AutomationElement.AutomationElementInformation, T> get) {
        try { return get(el.Cached); } catch { /* not cached (an element found, not raised): read it */ }
        return get(el.Current);
    }

    private static string? ControlTypeName(AutomationElement el) =>
        Read(el, i => i.ControlType)?.ProgrammaticName?.Replace("ControlType.", "");

    /// <summary>The nearest <paramref name="levels"/> ancestors, nearest first (fewer at the desktop).</summary>
    private static IReadOnlyList<ElementInfo> AncestorsOf(AutomationElement el, int levels) {
        var list = new List<ElementInfo>(levels);
        try {
            var walker = TreeWalker.ControlViewWalker;
            var node = walker.GetParent(el);
            while (node != null && list.Count < levels && node != AutomationElement.RootElement) {
                var info = Describe(node);
                if (info == null) break;
                list.Add(info);
                node = walker.GetParent(node);
            }
        } catch { }
        return list;
    }

    /// <summary>The combo box a list item belongs to (its drop-down list), within three levels, or null.</summary>
    private static AutomationElement? ComboBoxAround(AutomationElement el) {
        try {
            if (Read(el, i => i.ControlType) != ControlType.ListItem) return null;
            var walker = TreeWalker.ControlViewWalker;
            var node = walker.GetParent(el);
            for (var i = 0; i < 3 && node != null && node != AutomationElement.RootElement; i++) {
                if (node.Current.ControlType == ControlType.ComboBox) return node;
                node = walker.GetParent(node);
            }
        } catch { }
        return null;
    }

    private bool IsRepeatClick(string kind, ElementInfo info) {
        var now = DateTime.UtcNow;
        lock (_clickLock) {
            var repeat = _lastClick is { } last && last.kind == kind &&
                         IntentGate.Same(last.el, info) && now - last.at < RepeatClickWindow;
            _lastClick = (kind, info, now);
            return repeat;
        }
    }

    // The coalescer's hold: an address-bar value waits while the bar has
    // the focus (the user typing an address), and goes out once the focus
    // leaves it (the page navigated): the final address, once.
    private bool HoldAddressBar(string key) {
        if (!key.StartsWith(NavKeyPrefix, StringComparison.Ordinal)) return false;
        if (!_navFields.TryGetValue(key, out var bar)) return false;
        var focus = _intent.CurrentFocus;
        return focus != null && IntentGate.Same(bar, focus);
    }

    // Every event the recorder writes, inside the coalescer's lock.
    private void EmitOut(object evt) {
        if (evt is InteractionLine line) {
            if (line.CoalesceKey != null && IsRepeatValue(line)) return;
            // E6 / live finding 22: the first interaction WRITTEN for a pid
            // carries the coverage hint (a coalesced or left-out event must not
            // take it along, nor one the program made by itself).
            if (!line.Data.ContainsKey("user_acted")) TrySetCoverageHint(line.Data);
        }
        _onEvent(evt);
    }

    private bool IsRepeatValue(InteractionLine line) {
        var key = line.CoalesceKey!;
        var value = line.Data.TryGetValue("value", out var v) ? v as string : null;
        var now = DateTime.UtcNow;
        var addressBar = key.StartsWith(NavKeyPrefix, StringComparison.Ordinal);
        if (_lastValues.TryGetValue(key, out var last) && last.value == value &&
            (addressBar || now - last.at < SameValueWindow)) {
            return true;
        }
        _lastValues[key] = (value, now);
        return false;
    }

    private void NoteActivity(ElementInfo info) {
        if (_onActivity == null) return;
        var now = Environment.TickCount64;
        if (_activityAt.TryGetValue(info.Pid, out var last) && now - last < ActivityEveryMs) return;
        _activityAt[info.Pid] = now;
        var name = ProcessNameOf(info.Pid);
        if (name == null) return;
        try { _onActivity(name); } catch { }
    }

    private void NoteError(string kind, AutomationElement el, Exception ex) {
        Interlocked.Increment(ref _errors);
        _lastError = BuildErrorInfo(kind, el, ex);
    }

    /// <summary>
    /// A value as the analyst should read it: without U+FFFC (the object
    /// replacement character an empty or embedded-object web field reads
    /// back as) and without a closing paragraph mark (a rich edit's "\r").
    /// Blank comes back empty: there is no value.
    /// </summary>
    internal static string CleanValue(string? raw) {
        if (string.IsNullOrEmpty(raw)) return "";
        var s = raw.IndexOf('\uFFFC') >= 0 ? raw.Replace("\uFFFC", "") : raw;
        s = s.TrimEnd('\r', '\n');
        return string.IsNullOrWhiteSpace(s) ? "" : s;
    }

    /// <summary>A ToggleState (the enum, its number, or its name) as on | off | indeterminate; null when unknown.</summary>
    internal static string? ToggleStateName(object? state) {
        switch (state) {
            case null: return null;
            case ToggleState t: return ToggleStateName((int)t);
            case int i: return i switch { 0 => "off", 1 => "on", 2 => "indeterminate", _ => null };
            case string s:
                if (int.TryParse(s, out var n)) return ToggleStateName(n);
                var lower = s.Trim().ToLowerInvariant();
                return lower is "off" or "on" or "indeterminate" ? lower : null;
            default:
                try { return ToggleStateName(Convert.ToInt32(state, System.Globalization.CultureInfo.InvariantCulture)); }
                catch { return null; }
        }
    }

    private static string? ReadToggleState(AutomationElement el) {
        try {
            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out var p) && p is TogglePattern tp) {
                return ToggleStateName(tp.Current.ToggleState);
            }
        } catch { }
        return null;
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

    /// <summary>
    /// The debounce key of an element already read (its descriptor): the same
    /// rules and the same key as CoalesceKeyFromProps, the runtime id being
    /// already joined with "-".
    /// </summary>
    internal static string? CoalesceKeyOf(ElementInfo info) {
        if (!string.IsNullOrEmpty(info.AutomationId)) return $"{info.Pid}|aid|{info.AutomationId}";
        if (!string.IsNullOrEmpty(info.Name)) return $"{info.Pid}|n|{info.Name}|{info.ClassName}";
        if (!string.IsNullOrEmpty(info.RuntimeId)) return $"{info.Pid}|rid|{info.RuntimeId}";
        return null;
    }

    /// <summary>
    /// Pure debounce-key derivation: prefer the AutomationId, then
    /// Name+ClassName, then the UIA RuntimeId, else null (no stable
    /// identity -> caller emits immediately, uncoalesced). CoalesceKeyOf
    /// applies the same rules to an element already read.
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
        try { return new { selected_value = Read(el, i => i.Name) }; }
        catch { return null; }
    }

    /// <summary>
    /// Apply control-type / framework noise filters, then emit.
    /// In verbose mode the filter is a no-op.
    /// </summary>
    private void EmitFiltered(string kind, AutomationElement el, object? extra) {
        if (!_verbose && IsLowSignal(el)) return;
        var built = BuildEvent(kind, el, extra);
        if (built != null) _values.Emit(built);
    }

    private static bool IsLowSignal(AutomationElement el) {
        try {
            var fwk = Read(el, i => i.FrameworkId);
            var ctl = ControlTypeName(el);
            var aid = Read(el, i => i.AutomationId);
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
    /// recovery rungs (e.g. "ocr") reuse this selection unchanged. The
    /// candidate is cleaned first (CleanValue): an empty web input reads back
    /// through TextPattern as U+FFFC, which is no value (live finding 4).
    /// </summary>
    internal static (string? value, string? source) RecoverValue(
            string? primaryValue, string? candidateValue, string candidateSource) {
        if (!string.IsNullOrEmpty(primaryValue)) return (primaryValue, null);
        var candidate = CleanValue(candidateValue);
        if (candidate.Length > 0) return (candidate, candidateSource);
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
        try { return Read(el, i => i.IsPassword); }
        catch { return false; }
    }

    private InteractionLine? BuildEvent(string kind, AutomationElement el, object? extra) {
        try {
            var data = new Dictionary<string, object?> { ["kind"] = kind };
            TrySet(data, "control_type", () => ControlTypeName(el));
            TrySet(data, "automation_id", () => Read(el, i => i.AutomationId));
            TrySet(data, "name", () => Read(el, i => i.Name));
            TrySet(data, "class_name", () => Read(el, i => i.ClassName));
            TrySet(data, "framework_id", () => Read(el, i => i.FrameworkId));
            TrySet(data, "window_title", () => GetTopWindowTitle(el));
            TrySet(data, "process_name", () => GetProcessName(el));
            TrySet(data, "pid", () => Read(el, i => i.ProcessId));
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

            // E6: the coverage hint is set as the event is written (EmitOut),
            // on the first one written for the pid.
            return new InteractionLine { Ts = DateTime.UtcNow.ToString("o"), Data = data };
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

    // First event written per pid gets a coverage_hint describing how richly
    // UIA exposes that app, a signal the analyst can use to spot apps that
    // need a richer integration. Marks the pid so later events skip it.
    // Called as the event is written (EmitOut), so a value that a later
    // keystroke replaces in the coalescer, or an event left out, never takes
    // the hint with it (live finding 22).
    private void TrySetCoverageHint(Dictionary<string, object?> data) {
        if (!data.TryGetValue("pid", out var pidObj) || pidObj is not int pid) return;
        if (!_coveredPids.TryAdd(pid, 0)) return;
        var hint = CoverageHintFor(data);
        if (hint != null) data["coverage_hint"] = hint;
    }

    /// <summary>rich = a stable AutomationId, basic = a control type only, minimal = just a class name.</summary>
    internal static string? CoverageHintFor(IReadOnlyDictionary<string, object?> data) {
        var aid = data.TryGetValue("automation_id", out var aidV) ? aidV as string : null;
        if (!string.IsNullOrEmpty(aid)) return "rich";
        if (data.ContainsKey("control_type")) return "basic";
        if (data.ContainsKey("class_name")) return "minimal";
        return null;
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
        try { info["pid"] = Read(el, i => i.ProcessId); } catch { }
        try { info["process_name"] = GetProcessName(el); } catch { }
        try { info["control_type"] = ControlTypeName(el); } catch { }
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
        var title = top?.Current.Name;
        // A popup (a drop-down list, a context menu, Excel's formula
        // AutoComplete) is a window without a title: its events belong to
        // the window in front of the same program, not to a screen of their
        // own (live finding 13).
        if (string.IsNullOrEmpty(title)) {
            try { title = NativeMethods.ForegroundTitleOf(Read(el, i => i.ProcessId)) ?? title; } catch { }
        }
        return title;
    }

    private static string? GetProcessName(AutomationElement el) {
        try {
            var pid = Read(el, i => i.ProcessId);
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

/// <summary>
/// One interaction line of the recorder's stdout: <c>{"v":1,"type":"interaction","ts":...,"data":{...}}</c>
/// (property names in snake case by the serializer). <c>CoalesceKey</c> is
/// the recorder's own bookkeeping and is never written.
/// </summary>
internal sealed class InteractionLine {
    public int V { get; init; } = 1;
    public string Type { get; init; } = "interaction";
    public string Ts { get; init; } = "";
    public Dictionary<string, object?> Data { get; init; } = new();
    [System.Text.Json.Serialization.JsonIgnore]
    public string? CoalesceKey { get; set; }
}
