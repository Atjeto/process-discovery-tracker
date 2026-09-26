using System.Collections.Concurrent;
using Xunit;
using Pdt.Recorder;

namespace Pdt.Recorder.Tests;

// Pins the value_changed debouncer (ValueCoalescer): one event per burst,
// carrying the final value; FlushAll on shutdown; and (RP-24) submits
// racing the key's own expiring timer never throw, drop, or duplicate a
// value.
public class ValueCoalescerTests {

    private static bool WaitFor(Func<bool> condition, int timeoutMs = 3000) {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline) {
            if (condition()) return true;
            Thread.Sleep(5);
        }
        return condition();
    }

    [Fact]
    public void A_burst_on_one_key_emits_one_event_with_the_final_value() {
        var emitted = new ConcurrentQueue<object>();
        var coalescer = new ValueCoalescer(TimeSpan.FromMilliseconds(100), emitted.Enqueue);
        coalescer.Submit("42|aid|customer", "A");
        coalescer.Submit("42|aid|customer", "Ac");
        coalescer.Submit("42|aid|customer", "Acme");
        Assert.True(WaitFor(() => !emitted.IsEmpty), "the quiet window never emitted");
        Thread.Sleep(250);   // nothing else may follow
        Assert.Equal(new object[] { "Acme" }, emitted.ToArray());
    }

    [Fact]
    public void FlushAll_emits_each_pending_value_once_and_cancels_its_timer() {
        var emitted = new ConcurrentQueue<object>();
        var coalescer = new ValueCoalescer(TimeSpan.FromMilliseconds(200), emitted.Enqueue);
        coalescer.Submit("1|aid|a", "x");
        coalescer.Submit("1|aid|b", "y");
        coalescer.FlushAll();
        Assert.Equal(new[] { "x", "y" }, emitted.Cast<string>().OrderBy(s => s).ToArray());
        Thread.Sleep(400);   // past the window: the disposed timers must not fire
        Assert.Equal(2, emitted.Count);
    }

    // Live finding 5: a value typed 250 ms before a click was written after
    // the click (it waited out its quiet window). EmitAfterFlush writes the
    // waiting values first, in the order they were first typed, then the
    // click; a key the predicate leaves out keeps waiting.
    [Fact]
    public void A_click_is_written_after_the_values_typed_before_it() {
        var emitted = new ConcurrentQueue<object>();
        var coalescer = new ValueCoalescer(TimeSpan.FromMilliseconds(400), emitted.Enqueue);
        coalescer.Submit("9|aid|ord-qty", "Quantity 5");
        coalescer.Submit("9|aid|ord-date", "Delivery 06.10.2026");
        coalescer.Submit("nav|9|aid|view_1012", "address #order");
        coalescer.Submit("9|aid|ord-qty", "Quantity 5 (last key)");
        coalescer.EmitAfterFlush(k => !k.StartsWith("nav|"), "click Save order");
        Assert.Equal(new object[] { "Quantity 5 (last key)", "Delivery 06.10.2026", "click Save order" }, emitted.ToArray());
        // The address waits out its own window and comes after.
        Assert.True(WaitFor(() => emitted.Count == 4), "the left-out key never came");
        Assert.Equal("address #order", emitted.ToArray()[3]);
        Thread.Sleep(600);   // the flushed keys' timers are gone
        Assert.Equal(4, emitted.Count);
    }

    // The address bar's hold: a key the hold names waits while it is held,
    // goes out once let go, and a shutdown writes it regardless.
    [Fact]
    public void A_held_key_waits_until_it_is_let_go_and_shutdown_writes_it_anyway() {
        var emitted = new ConcurrentQueue<object>();
        var held = true;
        var coalescer = new ValueCoalescer(TimeSpan.FromMilliseconds(60), emitted.Enqueue,
                                           k => Volatile.Read(ref held) && k.StartsWith("nav|"));
        coalescer.Submit("nav|9|aid|view_1012", "127.0.0.1:8765/ord");
        coalescer.Submit("9|aid|ord-qty", "2");
        Assert.True(WaitFor(() => emitted.Count == 1), "the plain key never came");
        Thread.Sleep(300);   // several windows while held
        Assert.Equal(new object[] { "2" }, emitted.ToArray());
        Volatile.Write(ref held, false);
        Assert.True(WaitFor(() => emitted.Count == 2), "the let-go key never came");

        var emitted2 = new ConcurrentQueue<object>();
        var coalescer2 = new ValueCoalescer(TimeSpan.FromMilliseconds(60), emitted2.Enqueue, _ => true);
        coalescer2.Submit("nav|1|aid|view_1012", "typed, never let go");
        Thread.Sleep(200);
        Assert.Empty(emitted2);
        coalescer2.FlushAll();
        Assert.Equal(new object[] { "typed, never let go" }, emitted2.ToArray());
    }

    // RP-24: each writer owns one key and pauses about one window after
    // every submit, so the key's timer keeps expiring just as the next
    // submit arrives. The old inline coalescer emitted a value twice when
    // the value was written into an entry the timer callback had just
    // removed (8 of 8 runs of this test failed against it, 2026-09-23). The
    // other suspected symptom, Timer.Change throwing on the just-disposed
    // timer, does not occur on .NET 8 (Change returns false), but the test
    // still fails on any exception a submit throws.
    [Fact]
    public void Submits_racing_the_keys_expiring_timer_never_throw_drop_or_duplicate() {
        const int Writers = 16;
        const int ValuesPerWriter = 600;
        var emitted = new ConcurrentQueue<object>();
        var coalescer = new ValueCoalescer(TimeSpan.FromMilliseconds(1), emitted.Enqueue);
        var errors = new ConcurrentQueue<Exception>();
        var threads = Enumerable.Range(0, Writers).Select(w => new Thread(() => {
            try {
                for (var i = 0; i < ValuesPerWriter; i++) {
                    coalescer.Submit($"key{w}", $"{w}:{i}");
                    Thread.Sleep(1);
                }
            } catch (Exception ex) {
                errors.Enqueue(ex);
            }
        })).ToList();
        threads.ForEach(t => t.Start());
        threads.ForEach(t => t.Join());
        Thread.Sleep(100);        // let the last windows expire
        coalescer.FlushAll();     // and emit whatever is still pending

        Assert.Empty(errors);
        var values = emitted.Cast<string>().ToList();
        Assert.Equal(values.Count, values.Distinct().Count());   // no value emitted twice
        for (var w = 0; w < Writers; w++) {
            Assert.Contains($"{w}:{ValuesPerWriter - 1}", values);   // every final value lands
        }
    }
}
