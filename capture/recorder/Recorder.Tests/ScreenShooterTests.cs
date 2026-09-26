using System.Text.Json;
using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Pins the screenshot command the capture app sends (ScreenShooter): what a
// request may ask for, and the reply's shape. The capture itself needs a
// live screen; the packaged app's live recordings check it.
public class ScreenShooterTests {
    private static readonly JsonSerializerOptions Opts = new() {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static (ScreenShooter.Request? req, string? error) Parse(string json) {
        using var doc = JsonDocument.Parse(json);
        return ScreenShooter.Parse(doc.RootElement.Clone());
    }

    [Fact]
    public void A_full_request_is_read_with_its_point() {
        var (req, error) = Parse("""{"cmd":"screenshot","id":"s1","path":"D:\\rec\\screenshots\\a.jpg","quality":70,"screen":"active","x":2880,"y":540}""");
        Assert.Null(error);
        Assert.NotNull(req);
        Assert.Equal("s1", req!.Id);
        Assert.Equal(@"D:\rec\screenshots\a.jpg", req.Path);
        Assert.Equal(70, req.Quality);
        Assert.Equal("active", req.Screen);
        Assert.Equal(2880, req.X);
        Assert.Equal(540, req.Y);
    }

    [Fact]
    public void Defaults_the_quality_and_the_screen_and_takes_primary_when_asked() {
        var (req, _) = Parse("""{"id":"s2","path":"C:\\x\\b.JPG"}""");
        Assert.Equal(60, req!.Quality);
        Assert.Equal("active", req.Screen);
        Assert.Null(req.X);
        var (primary, _) = Parse("""{"id":"s3","path":"C:\\x\\c.jpg","screen":"primary","quality":400}""");
        Assert.Equal("primary", primary!.Screen);
        Assert.Equal(60, primary.Quality);
    }

    [Theory]
    [InlineData("""{"path":"C:\\x\\a.jpg"}""", "no id")]
    [InlineData("""{"id":"s4","path":"screenshots\\a.jpg"}""", "the path is not absolute")]
    [InlineData("""{"id":"s5","path":"C:\\Windows\\a.exe"}""", "the path is not a .jpg")]
    [InlineData("""{"id":"s6"}""", "the path is not absolute")]
    public void Writes_nothing_but_an_absolute_jpg(string json, string reason) {
        var (req, error) = Parse(json);
        Assert.Null(req);
        Assert.Equal(reason, error);
    }

    [Fact]
    public void The_reply_carries_the_id_and_either_the_path_or_the_error() {
        using var ok = JsonDocument.Parse(ScreenShooter.Reply("s1", true, @"D:\rec\a.jpg", null, Opts));
        Assert.Equal(1, ok.RootElement.GetProperty("v").GetInt32());
        Assert.Equal("screenshot_done", ok.RootElement.GetProperty("type").GetString());
        var data = ok.RootElement.GetProperty("data");
        Assert.Equal("s1", data.GetProperty("id").GetString());
        Assert.True(data.GetProperty("ok").GetBoolean());
        Assert.Equal(@"D:\rec\a.jpg", data.GetProperty("path").GetString());
        Assert.False(data.TryGetProperty("error", out _));

        using var failed = JsonDocument.Parse(ScreenShooter.Reply("s2", false, null, "no screen found", Opts));
        var fd = failed.RootElement.GetProperty("data");
        Assert.False(fd.GetProperty("ok").GetBoolean());
        Assert.Equal("no screen found", fd.GetProperty("error").GetString());
        Assert.False(fd.TryGetProperty("path", out _));
    }
}
