// Per-key debouncer for value_changed events: a burst of changes to one
// control coalesces into one event carrying the final value, emitted once
// the control has been quiet for the window (or at FlushAll on shutdown).
//
// RP-24: the previous inline version (UiaSubscriber.EmitValueChanged) ran
// ConcurrentDictionary.AddOrUpdate and then Timer.Change with no lock, while
// the key's timer callback ran TryRemove + Dispose on a pool thread. A
// callback landing between the two could remove the entry the new value had
// just been written into: the value was then emitted twice, once from the
// removed entry and once from a re-added one (reproduced by
// ValueCoalescerTests). A callback landing just before Change disposed the
// timer Change then re-armed; on .NET 8 that Change returns false instead of
// throwing. Here every read-modify-write of the map and every timer
// arm/dispose happens under one lock; the emit callback runs outside it.
//
// Plain objects in, plain objects out: unit-tested in Recorder.Tests without
// a live UI Automation tree.

using System;
using System.Collections.Generic;
using System.Threading;

namespace Pdt.Recorder;

internal sealed class ValueCoalescer {
    private readonly object _gate = new();
    private readonly Dictionary<string, Pending> _pending = new();
    private readonly TimeSpan _window;
    private readonly Action<object> _emit;

    public ValueCoalescer(TimeSpan window, Action<object> emit) {
        _window = window;
        _emit = emit;
    }

    /// <summary>Record the latest event for a key and (re)start its quiet window.</summary>
    public void Submit(string key, object evt) {
        lock (_gate) {
            if (_pending.TryGetValue(key, out var entry)) {
                entry.Event = evt;
                // Safe: an entry still in the map has a live timer (it is
                // disposed only under this lock, as it leaves the map).
                entry.Timer.Change(_window, Timeout.InfiniteTimeSpan);
                return;
            }
            var fresh = new Pending { Event = evt };
            // Created armed, inside the lock: its callback blocks on the lock
            // until the entry is complete and in the map.
            fresh.Timer = new Timer(_ => Fire(key, fresh), null, _window, Timeout.InfiniteTimeSpan);
            _pending[key] = fresh;
        }
    }

    /// <summary>Emit every pending event now and forget them (recorder shutdown).</summary>
    public void FlushAll() {
        List<object> events;
        lock (_gate) {
            events = new List<object>(_pending.Count);
            foreach (var entry in _pending.Values) {
                entry.Timer.Dispose();
                events.Add(entry.Event);
            }
            _pending.Clear();
        }
        foreach (var evt in events) _emit(evt);
    }

    private void Fire(string key, Pending owner) {
        object evt;
        lock (_gate) {
            // A callback that lost the race to FlushAll (its entry is gone, or
            // a newer entry now holds the key) must not touch the newer one.
            if (!_pending.TryGetValue(key, out var current) || !ReferenceEquals(current, owner)) return;
            _pending.Remove(key);
            owner.Timer.Dispose();
            evt = owner.Event;
        }
        _emit(evt);
    }

    private sealed class Pending {
        public object Event = null!;
        public Timer Timer = null!;
    }
}
