"""Per-team classifier trained on the central taxonomy's existing rules.
Predicts activity_label for events that no regex rule matched.
"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import yaml

CLASSIFIER_PATH = Path(__file__).resolve().parent.parent / "ml_models" / "classifier.pkl"


def train_from_taxonomy(taxonomy_path: str, sample_events: list[dict] | None = None) -> None:
    """Train a logistic-regression classifier on (event_text -> label)
    pairs synthesized from the taxonomy rules. Saves to CLASSIFIER_PATH.
    """
    import joblib  # type: ignore
    import numpy as np
    from sklearn.linear_model import LogisticRegression  # type: ignore
    from .embeddings import embed

    with open(taxonomy_path) as f:
        tax = yaml.safe_load(f)
    rules = tax.get("rules", []) or []
    texts: list[str] = []
    labels: list[str] = []
    for rule in rules:
        m = rule.get("match", {}) or {}
        app = m.get("app", "") or ""
        title_re = m.get("title_regex", "") or ""
        rep = title_re.replace(".*", " ").strip()
        texts.append(f"{app} | {rep}")
        labels.append(rule.get("label"))
    if sample_events:
        for ev in sample_events:
            lbl = ev.get("data", {}).get("activity_label")
            if lbl:
                texts.append(_event_to_text(ev))
                labels.append(lbl)

    if not texts:
        raise RuntimeError("No training data: taxonomy has no rules")
    if len(set(labels)) < 2:
        raise RuntimeError("Need at least 2 distinct labels to train a classifier")

    X = embed(texts)
    clf = LogisticRegression(max_iter=1000, multi_class="multinomial")
    clf.fit(X, labels)
    CLASSIFIER_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(clf, str(CLASSIFIER_PATH))


def predict(texts: list[str], min_confidence: float = 0.55) -> list[tuple[str | None, float]]:
    """Return [(label_or_None, confidence)] for each text. Below
    min_confidence the label is None (caller surfaces as suggestion).
    Returns all-None when the classifier file is missing."""
    if not CLASSIFIER_PATH.exists():
        return [(None, 0.0)] * len(texts)
    import joblib  # type: ignore
    import numpy as np
    from .embeddings import embed
    clf = joblib.load(str(CLASSIFIER_PATH))
    X = embed(texts)
    probs = clf.predict_proba(X)
    out: list[tuple[str | None, float]] = []
    for row in probs:
        i = int(np.argmax(row))
        c = float(row[i])
        out.append((clf.classes_[i] if c >= min_confidence else None, c))
    return out


def _event_to_text(ev: dict) -> str:
    d = ev.get("data", {}) or {}
    return f"{d.get('app', '')} | {d.get('title', '')}"
