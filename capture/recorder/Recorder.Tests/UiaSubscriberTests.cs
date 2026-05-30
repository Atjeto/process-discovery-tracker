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
