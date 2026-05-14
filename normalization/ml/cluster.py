"""Cluster uncovered events for batch labeling using HDBSCAN over
embeddings.
"""

from __future__ import annotations
from typing import Any

from .embeddings import embed, event_text


def cluster_uncovered(events: list[dict], min_cluster_size: int = 5) -> list[dict]:
    """Return list of clusters: [{ cluster_id, event_ids, sample_text, count }]."""
    if not events:
        return []
    import hdbscan  # type: ignore
    texts = [event_text(e) for e in events]
    X = embed(texts)
    clusterer = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric="euclidean")
    labels = clusterer.fit_predict(X)
    clusters: dict[int, list[dict]] = {}
    for ev, label in zip(events, labels):
        if label == -1:
            continue
        clusters.setdefault(int(label), []).append(ev)
    out: list[dict] = []
    for cid, evs in clusters.items():
        out.append({
            "cluster_id": cid,
            "event_ids": [e.get("event_id") for e in evs],
            "sample_text": event_text(evs[0]),
            "count": len(evs),
        })
    return out
