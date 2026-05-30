// OcrBridge -- the §11e identity-ladder last rung. When an element exposes
// no structured identity (identity_source == "none"), the recorder can
// capture its on-screen region and recover a text label via
// Windows.Media.Ocr -- a Win10+ system API: on-device, free, and (unlike
// Tesseract) no bundle inflation, since the engine is a system component.
// See ADR-0023.
//
// Default-OFF: the recorder only constructs this when `hello` carries
// ocr:true, so the screen-capture + OCR cost never touches an ordinary
// capture. Two entry points:
//   RecognizePng          -- the testable core (OCR a PNG image); pinned by
//                            a Recorder.Tests fact that OCRs rendered text.
//   RecognizeScreenRegion -- the production path (GDI+ capture -> core).
//                            Its live element -> capture -> label flow is
//                            validated against real low-UIA apps later
//                            (deferred, needs those apps); the OCR core
//                            itself is validated headlessly.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

namespace Pdt.Recorder;

public sealed class OcrBridge {
    private readonly OcrEngine? _engine;

    public OcrBridge() {
        // The engine binds to an installed OCR language pack. If none is
        // available the bridge is simply unavailable -- never an error.
        try {
            _engine = OcrEngine.TryCreateFromUserProfileLanguages()
                      ?? OcrEngine.TryCreateFromLanguage(new Language("en-US"));
        } catch {
            _engine = null;
        }
    }

    /// <summary>True when an OCR language pack bound successfully.</summary>
    public bool Available => _engine != null;

    /// <summary>
    /// Testable core: OCR a PNG-encoded image. Returns the recovered text
    /// (trimmed, whitespace-collapsed to a single line) or null if the
    /// engine is unavailable, the image won't decode, or no text is found.
    /// Safe on the recorder's threads -- it's a console app with no
    /// SynchronizationContext, so blocking on the WinRT async call cannot
    /// deadlock.
    /// </summary>
    public string? RecognizePng(Stream png) {
        if (_engine == null) return null;
        try { return RecognizePngAsync(png).GetAwaiter().GetResult(); }
        catch { return null; }
    }

    private async Task<string?> RecognizePngAsync(Stream png) {
        var decoder = await BitmapDecoder.CreateAsync(png.AsRandomAccessStream());
        using var bitmap = await decoder.GetSoftwareBitmapAsync();
        var result = await _engine!.RecognizeAsync(bitmap);
        var text = result.Text?.Trim();
        return string.IsNullOrEmpty(text) ? null : CollapseWhitespace(text);
    }

    /// <summary>
    /// Production path: capture a screen region (GDI+) and OCR it. Returns
    /// null on any failure (off-screen / absurd rect, capture or decode
    /// error, no text). Bounded so a bad UIA bounding box can't drive a
    /// huge capture. The OCR core is pinned by RecognizePng.
    /// </summary>
    public string? RecognizeScreenRegion(int x, int y, int width, int height) {
        if (_engine == null || width <= 0 || height <= 0) return null;
        if (width > 4000 || height > 4000) return null;   // bad bounding box, not a control
        try {
            using var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(x, y, 0, 0, new Size(width, height));
            }
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            ms.Position = 0;
            return RecognizePng(ms);
        } catch {
            return null;
        }
    }

    private static string CollapseWhitespace(string s) =>
        string.Join(" ", s.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}
