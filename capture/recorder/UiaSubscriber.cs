// Subscribes to UIA Invoked / SelectionItemSelected / TextChanged /
// FocusChanged / PropertyChanged events on the desktop root with
// TreeScope.Subtree. Resolves per-element fields safely (any field
// that throws on access is omitted).

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Windows.Automation;

namespace Pdt.Recorder;

public sealed class UiaSubscriber {
    private readonly JsonSerializerOptions _opts;
    private readonly Action<object> _onEvent;
    private bool _started;

    public UiaSubscriber(JsonSerializerOptions opts, Action<object> onEvent) {
        _opts = opts;
        _onEvent = onEvent;
    }

    public void Start() {
        if (_started) return;
        _started = true;
        var root = AutomationElement.RootElement;

        Automation.AddAutomationEventHandler(
            InvokePattern.InvokedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("invoked", (AutomationElement)s, null));

        Automation.AddAutomationEventHandler(
            SelectionItemPattern.ElementSelectedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("selection_changed", (AutomationElement)s,
                ExtractSelectionPayload((AutomationElement)s)));

        Automation.AddAutomationFocusChangedEventHandler(
            (s, e) => Emit("focus_changed", (AutomationElement)s, null));

        // Property-changed events for Toggle/Value/RangeValue
        Automation.AddAutomationPropertyChangedEventHandler(
            root, TreeScope.Subtree,
            (s, e) => OnPropertyChanged((AutomationElement)s, e),
            TogglePattern.ToggleStateProperty,
            ValuePattern.ValueProperty,
            RangeValuePattern.ValueProperty);

        // TextChanged - notification only, no payload
        Automation.AddAutomationEventHandler(
            TextPattern.TextChangedEvent, root, TreeScope.Subtree,
            (s, e) => Emit("text_changed", (AutomationElement)s, null));
    }

    public void Stop() {
        if (!_started) return;
        try { Automation.RemoveAllEventHandlers(); } catch { }
        _started = false;
    }

    private void OnPropertyChanged(AutomationElement el, AutomationPropertyChangedEventArgs e) {
        if (e.Property == TogglePattern.ToggleStateProperty) {
            Emit("toggle_changed", el, new { toggle_state = e.NewValue?.ToString()?.ToLowerInvariant() });
        } else if (e.Property == ValuePattern.ValueProperty ||
                   e.Property == RangeValuePattern.ValueProperty) {
            var raw = e.NewValue?.ToString() ?? "";
            // Length-clamp text values; range values are short numerics
            var v = raw.Length > 256 ? raw.Substring(0, 256) : raw;
            Emit("value_changed", el, new { value = v });
        }
    }

    private object? ExtractSelectionPayload(AutomationElement el) {
        try { return new { selected_value = el.Current.Name }; }
        catch { return null; }
    }

    private void Emit(string kind, AutomationElement el, object? extra) {
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
            _onEvent(new {
                v = 1, type = "interaction",
                ts = DateTime.UtcNow.ToString("o"),
                data,
            });
        } catch (Exception ex) {
            Console.Error.WriteLine($"emit failed: {ex.Message}");
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
}
