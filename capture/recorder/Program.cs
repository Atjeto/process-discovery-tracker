// Pdt.Recorder.Program - entry point.
// Sets up autoflushing stdout, reads control commands from stdin,
// owns the UiaSubscriber's lifecycle, and serializes interaction
// events to NDJSON via a single writer task.

using System;
using System.Collections.Concurrent;
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

        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        };

        var paused = 0;       // int for atomic Interlocked toggles
        var droppedTotal = 0L;
        var emittedTotal = 0L;
        var queue = new BlockingCollection<string>(boundedCapacity: 4096);

        var subscriber = new UiaSubscriber(options, evt => {
            if (Volatile.Read(ref paused) != 0) return;
            try {
                var line = JsonSerializer.Serialize(evt, options);
                if (!queue.TryAdd(line)) {
                    Interlocked.Increment(ref droppedTotal);
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"serialize failed: {e.Message}");
            }
        });

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
                }
            };
            try { Console.Out.WriteLine(JsonSerializer.Serialize(stats, options)); }
            catch { /* writer may have closed */ }
        };
        statsTimer.Start();

        Console.Out.WriteLine(JsonSerializer.Serialize(new {
            v = 1, type = "ready", ts = DateTime.UtcNow.ToString("o")
        }, options));

        subscriber.Start();

        // Control loop on stdin
        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null) {
            try {
                using var doc = JsonDocument.Parse(line);
                if (!doc.RootElement.TryGetProperty("cmd", out var cmdEl)) continue;
                var cmd = cmdEl.GetString();
                switch (cmd) {
                    case "pause":    Interlocked.Exchange(ref paused, 1); break;
                    case "resume":   Interlocked.Exchange(ref paused, 0); break;
                    case "shutdown": goto done;
                }
            } catch (Exception e) {
                Console.Error.WriteLine($"bad control line: {e.Message}");
            }
        }

    done:
        statsTimer.Stop();
        subscriber.Stop();
        queue.CompleteAdding();
        try { writer.Wait(TimeSpan.FromMilliseconds(1500)); } catch { }
        return 0;
    }
}
