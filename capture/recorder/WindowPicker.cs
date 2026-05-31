// Point-and-click window picker for ADR-0025 in-app vocabulary discovery.
//
// The old flow snapshotted the FOREGROUND window — but the act of clicking the
// viewer's "Snapshot" button makes the viewer itself the foreground window, so
// it snapshotted the wrong thing (a misclick/misread trap). Instead the viewer
// asks the recorder to enter a brief STANDBY: the operator clicks the window
// they want, and we resolve the TOP-LEVEL window under the cursor and report its
// handle + title back. The viewer shows a confirmation ("you clicked X — capture
// it?") and only THEN snapshots that specific handle.
//
// No global hook / message pump is needed — a console process can poll
// GetAsyncKeyState for the next click. This blocks one (short-lived) recorder
// instance, exactly like the snapshot path.

using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Pdt.Recorder;

public static class WindowPicker {
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int vKey);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int max);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    private const int VK_LBUTTON = 0x01;
    private const int VK_ESCAPE = 0x1B;
    private const uint GA_ROOT = 2;

    /// Wait up to <paramref name="timeoutMs"/> for the next left-click anywhere,
    /// then emit a `picked` line for the TOP-LEVEL window under the cursor.
    /// Emits `pick_cancelled` on Esc, timeout, or a resolve failure. `emitLine`
    /// writes one NDJSON line to stdout (same wire shape as the snapshot lines).
    public static Task RunAsync(int timeoutMs, Action<string> emitLine) {
        return Task.Run(() => {
            var deadline = Environment.TickCount64 + Math.Max(1000, timeoutMs);
            // Ignore a button that's already held (e.g. the click that dismissed
            // the viewer dialog) so we react only to a FRESH press.
            while ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0) Thread.Sleep(15);
            while (true) {
                if (Environment.TickCount64 > deadline) { emitLine(Cancel("timeout")); return; }
                if ((GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0) { emitLine(Cancel("escape")); return; }
                if ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0) {
                    // Let the click complete (wait for release) before resolving,
                    // so the target app receives a normal click too.
                    while ((GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0) Thread.Sleep(10);
                    if (!GetCursorPos(out var pt)) { emitLine(Cancel("no_cursor")); return; }
                    var hwnd = WindowFromPoint(pt);
                    if (hwnd == IntPtr.Zero) { emitLine(Cancel("no_window")); return; }
                    var top = GetAncestor(hwnd, GA_ROOT);
                    if (top == IntPtr.Zero) top = hwnd;
                    var sb = new StringBuilder(512);
                    GetWindowText(top, sb, sb.Capacity);
                    GetWindowThreadProcessId(top, out var pid);
                    emitLine(JsonSerializer.Serialize(new {
                        v = 1,
                        type = "picked",
                        data = new {
                            hwnd = top.ToInt64(),
                            window_title = sb.ToString(),
                            process_id = pid,
                        },
                    }));
                    return;
                }
                Thread.Sleep(20);
            }
        });
    }

    private static string Cancel(string reason) =>
        JsonSerializer.Serialize(new { v = 1, type = "pick_cancelled", data = new { reason } });
}
