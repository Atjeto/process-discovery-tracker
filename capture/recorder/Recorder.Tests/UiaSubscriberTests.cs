using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Seed tests for the recorder's pure decision logic, extracted out of the
// AutomationElement-coupled methods so they can run without a live UIA tree.
public class UiaSubscriberTests {

    // Pins IsLowSignalProps: Win32 layout chrome (Pane/Group/Window/Custom)
    // is dropped, Chrome internal-DOM scaffolding with no AutomationId is
    // dropped, but a real WPF control and a Chrome control with a page-set
    // AutomationId are kept.
    [Theory]
    // Win32 shell chrome -> low signal.
    [InlineData("Win32", "Pane", null, true)]
    [InlineData("Win32", "Group", "", true)]
    [InlineData("Win32", "Window", null, true)]
    [InlineData("Win32", "Custom", null, true)]
    // Win32 but a real control type -> keep.
    [InlineData("Win32", "Button", null, false)]
    // WPF reuses the same control types for real UI -> keep.
    [InlineData("Wpf", "Pane", null, false)]
    // Chrome render scaffolding, empty AutomationId -> low signal.
    [InlineData("Chrome", "Document", "", true)]
    [InlineData("Chrome", "Pane", null, true)]
    // Chrome control that carries a page-set AutomationId -> keep.
    [InlineData("Chrome", "Document", "search-box", false)]
    // Chrome control type not in the scaffolding set -> keep.
    [InlineData("Chrome", "Edit", null, false)]
    public void IsLowSignalProps_matches_recorder_filter(
            string? framework, string? controlType, string? automationId, bool expected) {
        Assert.Equal(expected,
            UiaSubscriber.IsLowSignalProps(framework, controlType, automationId, name: null));
    }

    // Pins ClampValue: values <= 256 chars pass through untouched; longer
    // values are cut to exactly 256 chars and flagged truncated.
    [Fact]
    public void ClampValue_clamps_at_256_and_flags_truncation() {
        // Under the limit: untouched, not flagged.
        var (shortVal, shortTrunc) = UiaSubscriber.ClampValue("Acme Corp");
        Assert.Equal("Acme Corp", shortVal);
        Assert.False(shortTrunc);

        // Exactly at the limit: untouched, not flagged (boundary is > max).
        var atLimit = new string('x', 256);
        var (atVal, atTrunc) = UiaSubscriber.ClampValue(atLimit);
        Assert.Equal(atLimit, atVal);
        Assert.False(atTrunc);

        // Over the limit: cut to 256, flagged.
        var (longVal, longTrunc) = UiaSubscriber.ClampValue(new string('y', 300));
        Assert.Equal(256, longVal.Length);
        Assert.True(longTrunc);
    }

    // Pins DetectFramework: the normalized toolkit taxonomy emitted as the
    // `framework` field (§11e). The value-add is the rows where the UIA
    // FrameworkId LIES -- Java/Qt/remoting hosts report "Win32" (or empty)
    // but the window class is the true tell, so the class-name signatures
    // must win over the FrameworkId.
    [Theory]
    // Honest FrameworkId -> direct mapping.
    [InlineData("Chrome", "Chrome_WidgetWin_1", "chromium")]
    [InlineData("WPF", "HwndWrapper[app;;guid]", "wpf")]
    [InlineData("WinForm", "WindowsForms10.Window.8.app.0", "winforms")]
    [InlineData("XAML", "Windows.UI.Core.CoreWindow", "winui")]
    [InlineData("Win32", "Notepad", "win32")]
    [InlineData("Win32", "DirectUIHWND", "win32")]
    // FrameworkId LIES: Java/Qt report Win32 (or empty) -> class wins.
    [InlineData("Win32", "SunAwtFrame", "java")]
    [InlineData("", "SunAwtDialog", "java")]
    [InlineData("Win32", "GlassWndClass-GlassWindowClass-3", "javafx")]
    [InlineData("Win32", "Qt5152QWindowIcon", "qt")]
    [InlineData("Win32", "Qt672QWindowIcon", "qt")]
    [InlineData("Win32", "QWidget", "qt")]
    // WinForms sometimes reports Win32; the WindowsForms10 class recovers it.
    [InlineData("Win32", "WindowsForms10.EDIT.app.0.141b42a_r6_ad1", "winforms")]
    // Remoting hosts (Citrix/RDP) -> "remote" (the wrong-side-of-the-glass signal).
    [InlineData("Win32", "TscShellContainerClass", "remote")]
    [InlineData("Win32", "wfica32", "remote")]
    [InlineData("Win32", "RAIL_window", "remote")]
    // Terminals -> "terminal" (text grid, no structured controls).
    [InlineData("Win32", "ConsoleWindowClass", "terminal")]
    [InlineData("Win32", "CASCADIA_HOSTING_WINDOW_CLASS", "terminal")]
    // Unmapped-but-present FrameworkId passes through lowercased; nothing -> unknown.
    [InlineData("Maui", "SomeClass", "maui")]
    [InlineData("", "", "unknown")]
    [InlineData(null, null, "unknown")]
    public void DetectFramework_normalizes_toolkit_and_beats_a_lying_framework_id(
            string? frameworkId, string? className, string expected) {
        Assert.Equal(expected, UiaSubscriber.DetectFramework(frameworkId, className));
    }

    // Pins RecoverValue: the value-recovery selection (§11e). A present
    // primary value passes through with no source flag; an empty primary
    // recovers from the fallback candidate (flagged with the passed-in
    // source); both empty -> nothing.
    [Fact]
    public void RecoverValue_recovers_from_candidate_only_when_primary_is_empty() {
        // Primary present -> pass through, no flag (and never overridden).
        var (v1, s1) = UiaSubscriber.RecoverValue("typed text", "fallback text", "text_pattern");
        Assert.Equal("typed text", v1);
        Assert.Null(s1);

        // Primary empty, candidate present -> recover + flag with the source.
        var (v2, s2) = UiaSubscriber.RecoverValue("", "Acme Corp", "text_pattern");
        Assert.Equal("Acme Corp", v2);
        Assert.Equal("text_pattern", s2);

        // Primary null, candidate present -> recover + flag.
        var (v3, s3) = UiaSubscriber.RecoverValue(null, "12345", "text_pattern");
        Assert.Equal("12345", v3);
        Assert.Equal("text_pattern", s3);

        // The source label is whatever the caller passes (future rungs reuse it).
        var (_, s4) = UiaSubscriber.RecoverValue("", "scanned", "ocr");
        Assert.Equal("ocr", s4);

        // Both empty -> no value, no source.
        var (v5, s5) = UiaSubscriber.RecoverValue("", "", "text_pattern");
        Assert.Null(v5);
        Assert.Null(s5);
    }

    // Pins ResolveIdentitySource: the identity-ladder rung. AutomationId
    // wins, then Name, then ClassName, else "none" (the OCR candidate).
    [Theory]
    [InlineData("customerId", "Customer", "Edit", "automation_id")]
    [InlineData("", "Customer", "Edit", "name")]
    [InlineData(null, null, "Edit", "class_name")]
    [InlineData("", "", "", "none")]
    [InlineData(null, null, null, "none")]
    public void ResolveIdentitySource_walks_the_ladder(
            string? automationId, string? name, string? className, string expected) {
        Assert.Equal(expected,
            UiaSubscriber.ResolveIdentitySource(automationId, name, className));
    }

    // Pins ComputeConfidence: each rung's base score, and the remote/
    // terminal cap that lowers confidence even when a field is present.
    [Theory]
    // Rung base scores on an ordinary toolkit.
    [InlineData("automation_id", "wpf", 0.95)]
    [InlineData("name", "chromium", 0.70)]
    [InlineData("class_name", "win32", 0.40)]
    [InlineData("ocr", "win32", 0.25)]   // a recovered label
    [InlineData("none", "win32", 0.10)]
    // Remote/terminal cap: a strong rung is still capped at 0.30 because the
    // captured field is an unreliable proxy for the real (pixel) control.
    [InlineData("automation_id", "remote", 0.30)]
    [InlineData("name", "terminal", 0.30)]
    // ...but the cap never RAISES a rung already below it.
    [InlineData("none", "terminal", 0.10)]
    [InlineData("ocr", "terminal", 0.25)]
    public void ComputeConfidence_blends_rung_with_toolkit(
            string identitySource, string framework, double expected) {
        Assert.Equal(expected, UiaSubscriber.ComputeConfidence(identitySource, framework));
    }

    // Pins ShouldOcr: the last rung fires ONLY when OCR is enabled, the
    // element has no structured identity, and there is a box to capture.
    [Theory]
    [InlineData("none", true, true, true)]      // the one firing case
    [InlineData("none", true, false, false)]    // OCR disabled -> never
    [InlineData("none", false, true, false)]    // no bounding box -> nothing to capture
    [InlineData("name", true, true, false)]     // already has identity -> skip
    [InlineData("class_name", true, true, false)]
    [InlineData("automation_id", true, true, false)]
    public void ShouldOcr_is_the_genuine_last_resort(
            string identitySource, bool hasBounds, bool ocrEnabled, bool expected) {
        Assert.Equal(expected, UiaSubscriber.ShouldOcr(identitySource, hasBounds, ocrEnabled));
    }

    // SECURITY (CRITICAL): a password / masked-secret control's value must
    // never reach the immutable events.jsonl. Pins both redaction gates:
    // ShouldRedactValue (the value path redacts a password text value but
    // exempts numeric range values) and ShouldOcr's isSecret suppression
    // (a secret element is never OCR'd, even as the identityless last resort).
    [Fact]
    public void Secret_controls_are_redacted_and_never_ocrd() {
        // A password text value redacts; a non-password does not; a range
        // value (slider/spinner) is numeric, never secret -> exempt.
        Assert.True(UiaSubscriber.ShouldRedactValue(isPassword: true, isRangeValue: false));
        Assert.False(UiaSubscriber.ShouldRedactValue(isPassword: false, isRangeValue: false));
        Assert.False(UiaSubscriber.ShouldRedactValue(isPassword: true, isRangeValue: true));

        // The would-fire OCR case (none + bounds + enabled) is suppressed when
        // the element is secret, but still fires for a non-secret element.
        Assert.True(UiaSubscriber.ShouldOcr("none", hasBounds: true, ocrEnabled: true, isSecret: false));
        Assert.False(UiaSubscriber.ShouldOcr("none", hasBounds: true, ocrEnabled: true, isSecret: true));
    }

    // Pins IsHostProcess: an interaction from PDT's OWN app (operator panel /
    // dialogs) must not be recorded. Match is case-insensitive and ignores
    // a trailing ".exe"; empty/absent on either side is never the host.
    [Theory]
    [InlineData("Process Discovery Tracker.exe", "Process Discovery Tracker.exe", true)]
    [InlineData("Process Discovery Tracker", "Process Discovery Tracker.exe", true)]   // .exe-insensitive
    [InlineData("PROCESS DISCOVERY TRACKER.EXE", "Process Discovery Tracker.exe", true)] // case-insensitive
    [InlineData("chrome.exe", "Process Discovery Tracker.exe", false)]                  // the work app stays
    [InlineData("electron.exe", "electron.exe", true)]                                 // dev host
    [InlineData("chrome.exe", "", false)]
    [InlineData("", "Process Discovery Tracker.exe", false)]
    [InlineData(null, "Process Discovery Tracker.exe", false)]
    public void IsHostProcess_drops_only_the_capture_app(
            string? processName, string? hostProcess, bool expected) {
        Assert.Equal(expected, UiaSubscriber.IsHostProcess(processName, hostProcess));
    }

    // Pins CoalesceKeyFromProps: AutomationId wins, then Name+ClassName,
    // then RuntimeId, else null (no stable identity).
    [Fact]
    public void CoalesceKeyFromProps_prefers_aid_then_name_then_runtime_id() {
        // AutomationId present -> aid key.
        Assert.Equal("42|aid|customerId",
            UiaSubscriber.CoalesceKeyFromProps(42, "customerId", "ignored", "Edit", new[] { 1, 2 }));

        // No AutomationId, Name present -> name|class key.
        Assert.Equal("42|n|Customer|TextBox",
            UiaSubscriber.CoalesceKeyFromProps(42, "", "Customer", "TextBox", new[] { 1, 2 }));

        // No AutomationId, no Name, RuntimeId present -> rid key (Chrome web input).
        Assert.Equal("7|rid|3-9-1",
            UiaSubscriber.CoalesceKeyFromProps(7, null, null, null, new[] { 3, 9, 1 }));

        // Nothing stable -> null (caller emits uncoalesced).
        Assert.Null(
            UiaSubscriber.CoalesceKeyFromProps(7, null, null, null, runtimeId: null));
        Assert.Null(
            UiaSubscriber.CoalesceKeyFromProps(7, "", "", "Edit", new int[0]));
    }
}
