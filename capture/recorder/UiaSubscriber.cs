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
//     (pid, automation_id || name) within a debounce window. Typing
//     "Customer Acme Corp" emits one event with the final value
//     instead of one per keystroke.
//   - Events from low-signal control types (Pane, Group, Window with
//     framework_id == "Win32") are dropped -- these are desktop shell
//     / layout chrome, not user actions.
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
    // Key: "{pid}|{automation_id}" (falls back to name/class when id is missing).
    // Value: latest pending event + timer that fires after the debounce window.
    private readonly ConcurrentDictionary<string, PendingValue> _pending = new();
    private static readonly TimeSpan ValueCoalesceWindow = TimeSpan.FromMilliseconds(750);

    // Control types whose UIA notifications are almost always layout
    // chrome rather than user action. Combined with Win32 framework
    // these are e.g. the taskbar, desktop window manager, AltTab list.
    private static readonly HashSet<string> LowSignalControlTypes = new(StringComparer.Ordinal) {
        "Pane", "Group", "Window", "Custom"
    };

    public UiaSubscriber(JsonSerializerOptions opts, Action<object> onEvent, bool verbose = false) {
        _opts = opts;
        _onEvent = onEvent;
        _verbose = verbose;
    }

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
    }

    public void Stop() {
        if (!_started) return;
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
            // Length-clamp text values; range values are short numerics
            var v = raw.Length > 256 ? raw.Substring(0, 256) : raw;
            EmitValueChanged(el, v);
        }
    }

    private void EmitValueChanged(AutomationElement el, string value) {
        if (_verbose) {
            EmitFiltered("value_changed", el, new { value });
            return;
        }
        var key = CoalesceKey(el);
        if (key == null) {
            // No stable identity -- emit immediately, no coalescing possible.
            EmitFiltered("value_changed", el, new { value });
            return;
        }
        var built = BuildEvent("value_changed", el, new { value });
        if (built == null) return;
        _pending.AddOrUpdate(key,
            // First entry for this key: schedule a flush.
            _ => new PendingValue { Event = built, Timer = NewTimer(key) },
            // Existing entry: replace the event, reset the timer.
            (_, existing) => {
                existing.Event = built;
                existing.Timer.Change(ValueCoalesceWindow, Timeout.InfiniteTimeSpan);
                return existing;
            });
    }

    private Timer NewTimer(string key) {
        return new Timer(_ => {
            if (_pending.TryRemove(key, out var pending)) {
                pending.Timer.Dispose();
                _onEvent(pending.Event);
            }
        }, null, ValueCoalesceWindow, Timeout.InfiniteTimeSpan);
    }

    private static string? CoalesceKey(AutomationElement el) {
        try {
            var pid = el.Current.ProcessId;
            var id = el.Current.AutomationId;
            if (!string.IsNullOrEmpty(id)) return $"{pid}|aid|{id}";
            var name = el.Current.Name;
            var cls = el.Current.ClassName;
            if (!string.IsNullOrEmpty(name)) return $"{pid}|n|{name}|{cls}";
            return null;
        } catch {
            return null;
        }
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
            // Win32 desktop shell chrome (taskbar, window manager) fires
            // Pane/Group/Window/Custom notifications continuously. WPF /
            // WinForms / WinUI use the same control types but for real
            // application UI, so we only drop the Win32 case.
            if (string.Equals(fwk, "Win32", StringComparison.Ordinal)) {
                var ctl = el.Current.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
                if (ctl != null && LowSignalControlTypes.Contains(ctl)) return true;
            }
            return false;
        } catch {
            return false;
        }
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
            return new {
                v = 1, type = "interaction",
                ts = DateTime.UtcNow.ToString("o"),
                data,
            };
        } catch (Exception ex) {
            Console.Error.WriteLine($"build event failed: {ex.Message}");
            return null;
        }
    }

    private static void TrySet<T>(IDictionary<string, object?> d, string key, Func<T> get) {
        try { var v = get(); if (v is not null) d[key] = v; } catch { }
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
