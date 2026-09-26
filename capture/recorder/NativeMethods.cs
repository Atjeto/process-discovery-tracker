// The few user32 calls the recorder makes outside UI Automation: the mouse
// pointer's position (the user's click on a control that takes no focus),
// the foreground window's title (a popup's events borrow it), and the
// per-monitor DPI awareness that keeps the pointer and UI Automation in the
// same (physical) pixels on a scaled display.

using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Pdt.Recorder;

internal static class NativeMethods {
    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] internal static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int max);
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    private static readonly IntPtr PerMonitorAwareV2 = new(-4);

    /// <summary>
    /// Per-monitor DPI awareness, set once at start: GetCursorPos and UI
    /// Automation's coordinates are then both physical pixels, so the element
    /// under the pointer is found on a 125 or 150 percent display too. A
    /// failure (already set, an older Windows) leaves the default.
    /// </summary>
    internal static void UsePhysicalPixels() {
        try { SetProcessDpiAwarenessContext(PerMonitorAwareV2); } catch { }
    }

    /// <summary>The process owning the foreground window, or null.</summary>
    internal static int? ForegroundProcessId() {
        try {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) return null;
            GetWindowThreadProcessId(h, out var owner);
            return owner == 0 ? null : (int)owner;
        } catch {
            return null;
        }
    }

    /// <summary>Whether the foreground window belongs to <paramref name="pid"/>.</summary>
    internal static bool IsForegroundProcess(int pid) {
        try {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) return false;
            GetWindowThreadProcessId(h, out var owner);
            return owner == (uint)pid;
        } catch {
            return false;
        }
    }

    /// <summary>The foreground window's title when that window belongs to <paramref name="pid"/>, else null.</summary>
    internal static string? ForegroundTitleOf(int pid) {
        try {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) return null;
            GetWindowThreadProcessId(h, out var owner);
            if (owner != (uint)pid) return null;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            var t = sb.ToString();
            return string.IsNullOrEmpty(t) ? null : t;
        } catch {
            return null;
        }
    }
}
