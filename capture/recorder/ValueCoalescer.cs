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
// arm/dispose happens under one lock.
//
// Order (lane LF-SME, live finding 5): a value typed just before a click was
// written after it, because the value waited out its quiet window while the
// click went straight out. Every event the recorder writes now leaves through
// this class, under its lock: EmitAfterFlush writes the pending values first
// and then the click, and a timer that fires meanwhile waits for the lock, so
// no value can overtake or be overtaken. The emit callback therefore runs
// inside the lock; it must not call back into the coalescer (the recorder's
// callback only serializes and queues a line).
//
// Hold: a key the hold predicate names (the browser's address bar while the
// user types in it) is not written when its window ends; its window starts
// again, until the predicate lets it go.
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
    private readonly Func<string, bool>? _hold;
    private long _order;

    public ValueCoalescer(TimeSpan window, Action<object> emit, Func<string, bool>? hold = null) {
        _window = window;
        _emit = emit;
        _hold = hold;
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
            var fresh = new Pending { Event = evt, Order = ++_order };
            // Created armed, inside the lock: its callback blocks on the lock
            // until the entry is complete and in the map.
            fresh.Timer = new Timer(_ => Fire(key, fresh), null, _window, Timeout.InfiniteTimeSpan);
            _pending[key] = fresh;
        }
    }

    /// <summary>Write one event now, in order with the values this class writes.</summary>
    public void Emit(object evt) {
        lock (_gate) { _emit(evt); }
    }

    /// <summary>
    /// Write the pending values whose key <paramref name="which"/> names (in the
    /// order they were first typed), then <paramref name="evt"/>: a click never
    /// comes before the value typed ahead of it.
    /// </summary>
    public void EmitAfterFlush(Func<string, bool> which, object evt) {
        lock (_gate) {
            foreach (var e in TakeWhere(which)) _emit(e);
            _emit(evt);
        }
    }

    /// <summary>Emit every pending event now and forget them (recorder shutdown); a hold does not apply.</summary>
    public void FlushAll() {
        lock (_gate) {
            foreach (var e in TakeWhere(_ => true)) _emit(e);
        }
    }

    // Under the lock: remove the matching entries, oldest first, and return their events.
    private List<object> TakeWhere(Func<string, bool> which) {
        var hits = new List<KeyValuePair<string, Pending>>();
        foreach (var kv in _pending) {
            if (which(kv.Key)) hits.Add(kv);
        }
        hits.Sort((a, b) => a.Value.Order.CompareTo(b.Value.Order));
        var events = new List<object>(hits.Count);
        foreach (var kv in hits) {
            _pending.Remove(kv.Key);
            kv.Value.Timer.Dispose();
            events.Add(kv.Value.Event);
        }
        return events;
    }

    private void Fire(string key, Pending owner) {
        lock (_gate) {
            // A callback that lost the race to a flush (its entry is gone, or
            // a newer entry now holds the key) must not touch the newer one.
            if (!_pending.TryGetValue(key, out var current) || !ReferenceEquals(current, owner)) return;
            if (_hold != null && _hold(key)) {
                owner.Timer.Change(_window, Timeout.InfiniteTimeSpan);
                return;
            }
            _pending.Remove(key);
            owner.Timer.Dispose();
            _emit(owner.Event);
        }
    }

    private sealed class Pending {
        public object Event = null!;
        public Timer Timer = null!;
        public long Order;
    }
}
