"""Sentence-transformer embeddings for (app, window_title, name) triples.
Exports the model to ONNX once at first run; loads ONNX for inference.
"""

from __future__ import annotations
from pathlib import Path
import numpy as np

try:
    import onnxruntime as ort
except ImportError as _e:
    ort = None  # type: ignore

_session = None
_tokenizer = None

MODEL_DIR = Path(__file__).resolve().parent.parent / "ml_models" / "all-MiniLM-L6-v2"


def _ensure_loaded():
    global _session, _tokenizer
    if _session is not None:
        return
    if ort is None:
        raise RuntimeError("onnxruntime is not installed; install ML deps from requirements.txt")
    onnx_path = MODEL_DIR / "model.onnx"
    if not onnx_path.exists():
        _export_onnx()
    _session = ort.InferenceSession(
        str(onnx_path),
        providers=["CPUExecutionProvider"],
    )
    from transformers import AutoTokenizer  # type: ignore
    _tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))


def _export_onnx():
    """One-time: export the sentence-transformer model to ONNX. Called
    automatically on first use if the .onnx is missing."""
    from sentence_transformers import SentenceTransformer  # type: ignore
    import torch  # type: ignore
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    m = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    m.save(str(MODEL_DIR))
    sample = m.tokenize(["sample"])
    torch.onnx.export(
        m._first_module().auto_model,
        (sample["input_ids"], sample["attention_mask"]),
        str(MODEL_DIR / "model.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=["last_hidden_state"],
        dynamic_axes={"input_ids": {0: "batch", 1: "seq"},
                      "attention_mask": {0: "batch", 1: "seq"}},
        opset_version=17,
    )


def embed(texts: list[str]) -> np.ndarray:
    """Return (N, 384) array of normalized embeddings."""
    _ensure_loaded()
    enc = _tokenizer(texts, padding=True, truncation=True, max_length=128,
                     return_tensors="np")
    out = _session.run(None, {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
    })[0]
    # Mean pool with attention mask
    mask = enc["attention_mask"][:, :, None].astype(np.float32)
    summed = (out * mask).sum(axis=1)
    counts = mask.sum(axis=1).clip(min=1)
    mean = summed / counts
    norms = np.linalg.norm(mean, axis=1, keepdims=True).clip(min=1e-9)
    return mean / norms


def event_text(ev: dict) -> str:
    """Canonical text representation of an event for embedding."""
    d = ev.get("data", {})
    app = d.get("app") or d.get("process_name") or ""
    title = d.get("title") or d.get("window_title") or ""
    name = d.get("name") or ""
    label = d.get("activity_label") or ""
    return " | ".join(filter(None, [app, title, name, label]))
