using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Pins the OcrBridge core (§11e): render known text to a bitmap and assert
// Windows.Media.Ocr recovers it. This validates the OCR engine integration
// headlessly -- the live element -> screen-capture -> label end-to-end is
// validated against real low-UIA apps later (deferred, needs those apps).
public class OcrBridgeTests {

    // Render a string to an in-memory PNG using GDI+ (the same path the
    // production RecognizeScreenRegion feeds OCR, minus the screen grab).
    private static MemoryStream RenderTextPng(string text) {
        var bmp = new Bitmap(460, 96, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) {
            g.Clear(Color.White);
            using var f = new Font("Arial", 32, FontStyle.Bold);
            g.DrawString(text, f, Brushes.Black, 8, 8);
        }
        var ms = new MemoryStream();
        bmp.Save(ms, ImageFormat.Png);
        bmp.Dispose();
        ms.Position = 0;
        return ms;
    }

    [Fact]
    public void RecognizePng_recovers_rendered_text() {
        var bridge = new OcrBridge();
        // No OCR language pack on this machine -> the bridge is inert by
        // design; skip rather than fail (the gating/wiring is pinned
        // separately, and CI runners ship the en OCR pack).
        if (!bridge.Available) return;

        using var png = RenderTextPng("INVOICE 12345");
        var text = bridge.RecognizePng(png);

        Assert.NotNull(text);
        // OCR can fumble spacing/case; assert the digits survive the round trip.
        Assert.Contains("12345", text!.Replace(" ", ""));
    }

    [Fact]
    public void RecognizePng_on_a_blank_image_returns_null() {
        var bridge = new OcrBridge();
        if (!bridge.Available) return;

        using var png = RenderTextPng("   ");   // whitespace only -> no text
        Assert.Null(bridge.RecognizePng(png));
    }
}
