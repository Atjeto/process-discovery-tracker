// Screenshots for the capture app, taken here in the recorder's own process
// (the owner, 2026-09-26). Electron's screen capture held the capture app's
// main process for about 0.4 s a shot on one screen, longer with more
// screens (it grabs every screen each time): the recording bar froze and a
// transaction key pressed meanwhile was stamped late. GDI copies one screen
// here in tens of milliseconds, and the capture app never waits.
//
// The screen: the one holding a point the capture app names (the middle of
// the last window the SME worked in, from its foreground poll), else the one
// holding the window in front, or the main screen when asked. All in
// physical pixels: the process is per-monitor DPI aware (NativeMethods), as
// the capture app's window positions are, so a scaled screen finds its
// windows. The recording bar asks Windows to be left out of screen captures
// (setContentProtection), so it is not in the picture.
//
// Command (stdin): {"cmd":"screenshot","id":"<id>","path":"<absolute .jpg>",
//                   "quality":60,"screen":"active"|"primary","x"?:int,"y"?:int}
// Reply (stdout):  {"v":1,"type":"screenshot_done","data":{"id","ok","path"?,"error"?}}

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;

namespace Pdt.Recorder;

internal static class ScreenShooter {
    /// <summary>A screenshot asked for: where to save it, its JPEG quality,
    /// which screen ("active" or "primary") and, optionally, a point on it.</summary>
    internal sealed record Request(string Id, string Path, long Quality, string Screen, int? X, int? Y);

    /// <summary>
    /// The request in a command, or the reason it cannot be served. The path
    /// must be absolute and end in .jpg: the recorder writes nothing else.
    /// </summary>
    internal static (Request? request, string? error) Parse(JsonElement root) {
        string? Str(string name) =>
            root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;
        int? Int(string name) =>
            root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number &&
            el.TryGetInt32(out var v) ? v : null;

        var id = Str("id");
        if (string.IsNullOrWhiteSpace(id)) return (null, "no id");
        var path = Str("path");
        if (string.IsNullOrWhiteSpace(path) || !System.IO.Path.IsPathFullyQualified(path)) {
            return (null, "the path is not absolute");
        }
        if (!string.Equals(System.IO.Path.GetExtension(path), ".jpg", StringComparison.OrdinalIgnoreCase)) {
            return (null, "the path is not a .jpg");
        }
        var quality = Int("quality") ?? 60;
        if (quality < 1 || quality > 100) quality = 60;
        var screen = Str("screen") == "primary" ? "primary" : "active";
        return (new Request(id!, path!, quality, screen, Int("x"), Int("y")), null);
    }

    /// <summary>Serve one request off the control loop; the reply goes to <paramref name="emit"/>.</summary>
    internal static Task RunAsync(Request req, Action<string> emit, JsonSerializerOptions opts) =>
        Task.Run(() => {
            try {
                var rect = ScreenRect(req) ?? throw new InvalidOperationException("no screen found");
                Capture(rect, req.Path, req.Quality);
                emit(Reply(req.Id, true, req.Path, null, opts));
            } catch (Exception e) {
                emit(Reply(req.Id, false, null, e.Message, opts));
            }
        });

    /// <summary>The reply line for a request (also for one that could not be read).</summary>
    internal static string Reply(string id, bool ok, string? path, string? error, JsonSerializerOptions opts) =>
        JsonSerializer.Serialize(new {
            v = 1,
            type = "screenshot_done",
            data = new { id, ok, path, error },
        }, opts);

    // The screen's rectangle in physical pixels.
    private static Rectangle? ScreenRect(Request req) {
        IntPtr monitor;
        if (req.Screen == "primary") {
            monitor = MonitorFromPoint(new POINT { X = 0, Y = 0 }, MONITOR_DEFAULTTOPRIMARY);
        } else if (req.X is int x && req.Y is int y) {
            monitor = MonitorFromPoint(new POINT { X = x, Y = y }, MONITOR_DEFAULTTONEAREST);
        } else {
            monitor = MonitorFromWindow(NativeMethods.GetForegroundWindow(), MONITOR_DEFAULTTONEAREST);
        }
        if (monitor == IntPtr.Zero) return null;
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref info)) return null;
        var r = info.rcMonitor;
        return new Rectangle(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }

    // Copy the screen and save it as a JPEG, written under a temporary name
    // and moved in whole, so the capture app never reads half a file.
    private static void Capture(Rectangle r, string path, long quality) {
        if (r.Width <= 0 || r.Height <= 0) throw new InvalidOperationException("an empty screen");
        using var bmp = new Bitmap(r.Width, r.Height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(bmp)) {
            // BitBlt with CAPTUREBLT, so layered windows (menus, tooltips) are
            // in the picture too; Graphics.CopyFromScreen refuses that flag.
            var dest = g.GetHdc();
            var screen = GetDC(IntPtr.Zero);
            try {
                if (!BitBlt(dest, 0, 0, r.Width, r.Height, screen, r.Left, r.Top, SRCCOPY | CAPTUREBLT)) {
                    throw new InvalidOperationException("the screen could not be copied (" + Marshal.GetLastWin32Error() + ")");
                }
            } finally {
                ReleaseDC(IntPtr.Zero, screen);
                g.ReleaseHdc(dest);
            }
        }
        var jpeg = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
        using var ps = new EncoderParameters(1);
        ps.Param[0] = new EncoderParameter(Encoder.Quality, quality);
        var dir = System.IO.Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var part = path + ".part";
        bmp.Save(part, jpeg, ps);
        File.Move(part, path, overwrite: true);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }

    private const uint MONITOR_DEFAULTTOPRIMARY = 1;
    private const uint MONITOR_DEFAULTTONEAREST = 2;
    private const int SRCCOPY = 0x00CC0020;
    private const int CAPTUREBLT = 0x40000000;

    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr src, int srcX, int srcY, int rop);

    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
}
