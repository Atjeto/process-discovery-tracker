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
