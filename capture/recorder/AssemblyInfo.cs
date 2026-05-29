using System.Runtime.CompilerServices;

// Expose internal static decision helpers (IsLowSignalProps, ClampValue,
// CoalesceKeyFromProps) to the xUnit test project so the pure logic can be
// unit-tested without a live UI-Automation tree.
[assembly: InternalsVisibleTo("Recorder.Tests")]
