// Pdt.Recorder.Program - entry point.
// Sets up autoflushing stdout, reads control commands from stdin,
// owns the UiaSubscriber's lifecycle, and serializes interaction
// events to NDJSON via a single writer task.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Pdt.Recorder;

public static class Program {
    public static async Task<int> Main(string[] args) {
        // Force autoflush so each NDJSON line is delivered immediately
        // when stdout is redirected to a pipe (Electron child spawn).
        var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
        Console.SetOut(stdout);
        var stderr = new StreamWriter(Console.OpenStandardError()) { AutoFlush = true };
        Console.SetError(stderr);

        // Physical pixels for the mouse pointer and UI Automation alike, so the
        // element under the pointer is found on a scaled display (IntentGate).
        NativeMethods.UsePhysicalPixels();

        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };

        var paused = 0;       // int for atomic Interlocked toggles
        var droppedTotal = 0L;
        var emittedTotal = 0L;
        var queue = new BlockingCollection<string>(boundedCapacity: 4096);

        // Verbose mode is set from the `hello` control message before
        // Start() is called, so the subscription set can branch on it.
        var verbose = false;
        UiaSubscriber? subscriber = null;
        Action<object> onEvent = evt => {
            if (Volatile.Read(ref paused) != 0) return;
            try {
                var line = JsonSerializer.Serialize(evt, options);
                if (!queue.TryAdd(line)) {
                    Interlocked.Increment(ref droppedTotal);
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"serialize failed: {e.Message}");
            }
        };

        // Typing the recorder has seen but not written yet (a value waits out
        // its quiet window): `{"type":"activity","data":{"process_name"}}`, at
        // most every 2 s per program. The capture app counts it as recorded
        // input for its "not being recorded" check; it is never written to
        // events.jsonl. Straight to the synchronized Console.Out (like the
        // snapshot lines), so the interaction counters stay interactions.
        Action<string> onActivity = processName => {
            if (Volatile.Read(ref paused) != 0) return;
            try {
                Console.Out.WriteLine(JsonSerializer.Serialize(new {
                    v = 1, type = "activity",
                    ts = DateTime.UtcNow.ToString("o"),
                    data = new { process_name = processName },
                }, options));
            } catch { /* best effort: a check's hint, not a record */ }
        };

        var writer = Task.Run(() => {
            foreach (var line in queue.GetConsumingEnumerable()) {
                Console.Out.WriteLine(line);
                Interlocked.Increment(ref emittedTotal);
            }
        });

        // stats every 30s
        var statsTimer = new System.Timers.Timer(30_000) { AutoReset = true };
        statsTimer.Elapsed += (_, __) => {
            var stats = new {
                v = 1, type = "stats",
                ts = DateTime.UtcNow.ToString("o"),
                data = new {
                    queued = queue.Count,
                    dropped_total = Interlocked.Read(ref droppedTotal),
                    emitted_total = Interlocked.Read(ref emittedTotal),
                    errors = subscriber?.ErrorCount ?? 0L,
                    last_error = subscriber?.LastError,
                }
            };
            try { Console.Out.WriteLine(JsonSerializer.Serialize(stats, options)); }
            catch { /* writer may have closed */ }
        };
        statsTimer.Start();

        Console.Out.WriteLine(JsonSerializer.Serialize(new {
            v = 1, type = "ready", ts = DateTime.UtcNow.ToString("o")
        }, options));

        // Control loop on stdin. The `hello` command (sent first by the
        // Electron parent) optionally carries a `verbose` flag that
        // toggles the firehose-mode subscription set. Subscriber.Start()
        // is deferred until we've seen hello.
        // Screenshots still being taken: a shutdown waits for them briefly,
        // so the last one (the end marker's) is written whole and answered.
        var shots = new ConcurrentDictionary<Task, byte>();
        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null) {
            try {
                using var doc = JsonDocument.Parse(line);
                if (!doc.RootElement.TryGetProperty("cmd", out var cmdEl)) continue;
                var cmd = cmdEl.GetString();
                switch (cmd) {
                    case "hello": {
                        if (doc.RootElement.TryGetProperty("verbose", out var vEl) &&
                            vEl.ValueKind == JsonValueKind.True) {
                            verbose = true;
                        }
                        // debounce_ms tunes the value_changed coalescing window;
                        // fall back to 750ms when the field is absent or invalid.
                        var debounceMs = 750;
                        if (doc.RootElement.TryGetProperty("debounce_ms", out var dEl) &&
                            dEl.ValueKind == JsonValueKind.Number &&
                            dEl.TryGetInt32(out var dVal) && dVal > 0) {
                            debounceMs = dVal;
                        }
                        // ocr enables the §11e last-resort OCR rung for this
                        // session (default off). Only worth it on known
                        // low-UIA apps; trades latency on identityless
                        // elements for a recovered text label.
                        var ocr = doc.RootElement.TryGetProperty("ocr", out var oEl) &&
                                  oEl.ValueKind == JsonValueKind.True;
                        // host_process: the capture app's own exe. Interactions
                        // from it are PDT's own windows and are never emitted.
                        string? hostProcess = null;
                        if (doc.RootElement.TryGetProperty("host_process", out var hpEl) &&
                            hpEl.ValueKind == JsonValueKind.String) {
                            hostProcess = hpEl.GetString();
                        }
                        // A repeated hello must be idempotent: stop the prior
                        // subscriber first. Otherwise its UIA event handlers leak
                        // (they are never removed) and every interaction is
                        // captured TWICE -- a silent data-integrity bug found by
                        // the stress harness (4 invokes -> 8 events).
                        subscriber?.Stop();
                        subscriber = new UiaSubscriber(options, onEvent, verbose, debounceMs, ocr, hostProcess, onActivity);
                        subscriber.Start();
                        break;
                    }
                    case "pause":    Interlocked.Exchange(ref paused, 1); break;
                    case "resume":   Interlocked.Exchange(ref paused, 0); break;
                    case "snapshot": {
                        // ADR-0025: one-shot UIA window snapshot for in-app
                        // vocabulary discovery. target = "foreground" (default)
                        // or a decimal HWND; passes = 2 (default) walks twice
                        // ≥1s apart so the picker can diff for volatile ids.
                        // Emitted lines are written straight to stdout (not
                        // through the interaction queue) so they're unaffected
                        // by pause and ordered relative to snapshot_done.
                        var target = doc.RootElement.TryGetProperty("target", out var tEl) &&
                                     tEl.ValueKind == JsonValueKind.String
                            ? tEl.GetString() : "foreground";
                        var passes = 2;
                        if (doc.RootElement.TryGetProperty("passes", out var pEl) &&
                            pEl.ValueKind == JsonValueKind.Number &&
                            pEl.TryGetInt32(out var pVal) && pVal > 0) {
                            passes = pVal;
                        }
                        // Fire-and-forget: do NOT await inside the stdin control
                        // loop. Awaiting blocks the loop for the whole snapshot,
                        // so a pause / resume / shutdown sent meanwhile is ignored
                        // until it returns. The snapshot writes straight to
                        // Console.Out (a synchronized writer), so it is safe to run
                        // alongside the loop.
                        FireAndForget(Snapshotter.RunAsync(target, passes, options,
                            l => { try { Console.Out.WriteLine(l); } catch { } }));
                        break;
                    }
                    case "pick": {
                        // ADR-0025: point-and-click window pick. Standby for the
                        // operator's next click, then report the top-level window
                        // under the cursor so the viewer can confirm + snapshot it
                        // (instead of grabbing the foreground, which the button
                        // click steals). Blocks this short-lived instance, like
                        // snapshot. timeout_ms default 30s.
                        var pickTimeout = 30000;
                        if (doc.RootElement.TryGetProperty("timeout_ms", out var ptEl) &&
                            ptEl.ValueKind == JsonValueKind.Number &&
                            ptEl.TryGetInt32(out var ptVal) && ptVal > 0) {
                            pickTimeout = ptVal;
                        }
                        // Fire-and-forget for the same reason as snapshot: a 30s
                        // pick must not freeze the control loop (so a shutdown can
                        // still cancel it promptly).
                        FireAndForget(WindowPicker.RunAsync(pickTimeout,
                            l => { try { Console.Out.WriteLine(l); } catch { } }));
                        break;
                    }
                    case "screenshot": {
                        // A screenshot for the capture app, taken here so the
                        // capture app never waits for it (ScreenShooter). Off the
                        // control loop, like snapshot; the reply goes straight
                        // to Console.Out (a synchronized writer).
                        var (shot, why) = ScreenShooter.Parse(doc.RootElement);
                        if (shot == null) {
                            var id = doc.RootElement.TryGetProperty("id", out var idEl) &&
                                     idEl.ValueKind == JsonValueKind.String ? idEl.GetString() : null;
                            if (!string.IsNullOrEmpty(id)) {
                                Console.Out.WriteLine(ScreenShooter.Reply(id!, false, null, why, options));
                            }
                            break;
                        }
                        var shotTask = ScreenShooter.RunAsync(shot, l => { try { Console.Out.WriteLine(l); } catch { } }, options);
                        shots[shotTask] = 0;
                        _ = shotTask.ContinueWith(t => shots.TryRemove(t, out _), TaskScheduler.Default);
                        FireAndForget(shotTask);
                        break;
                    }
                    case "shutdown": goto done;
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"bad control line: {e.Message}");
            }
        }

    done:
        try { Task.WaitAll(new List<Task>(shots.Keys).ToArray(), TimeSpan.FromMilliseconds(1000)); } catch { }
        statsTimer.Stop();
        subscriber?.Stop();
        queue.CompleteAdding();
        try { writer.Wait(TimeSpan.FromMilliseconds(1500)); } catch { }
        return 0;
    }

    // Run a task without awaiting it (keeps the stdin control loop responsive)
    // while still OBSERVING faults -- an unobserved Task exception would
    // otherwise be swallowed silently. Errors land on stderr like the rest.
    private static void FireAndForget(Task t) {
        t.ContinueWith(
            x => Console.Error.WriteLine($"background task failed: {x.Exception?.GetBaseException().Message}"),
            TaskContinuationOptions.OnlyOnFaulted);
    }
}
