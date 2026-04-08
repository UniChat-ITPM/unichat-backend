"""
Singlish → Sinhala (Unicode) conversion API.

Loads an mT5 seq2seq checkpoint from ./assets (tokenizer + config + weights).
Place model weight files next to config.json (e.g. model.safetensors or pytorch_model.bin).
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request
from flask_cors import CORS

LOGGER = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).resolve().parent / "assets"
DEFAULT_PORT = int(os.environ.get("PORT", "5050"))

_app = Flask(__name__)
CORS(_app)

_tokenizer = None
_model = None
_generation_config = None
_model_load_error: str | None = None


class ModelLoadError(Exception):
    """Tokenizer or checkpoint could not be loaded from assets."""


def _terminal_model_status(loaded: bool, detail: str = "") -> None:
    """Print model load state so it is visible in the terminal running Flask."""
    suffix = f" — {detail}" if detail else ""
    state = "YES" if loaded else "NO"
    print(f"[conversion-engine] Model loaded: {state}{suffix}", flush=True)


def _record_load_failure(msg: str) -> None:
    global _model_load_error
    _model_load_error = msg
    _terminal_model_status(False, msg)


def _load_model() -> None:
    """Load tokenizer and weights once; cache failures so requests do not retry blindly."""
    global _tokenizer, _model, _generation_config, _model_load_error

    if _model is not None and _tokenizer is not None:
        return

    if _model_load_error is not None:
        raise ModelLoadError(_model_load_error)

    if not ASSETS_DIR.is_dir():
        msg = f"Model assets directory missing: {ASSETS_DIR}"
        LOGGER.error(msg)
        _record_load_failure(msg)
        raise ModelLoadError(msg)

    try:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, GenerationConfig
    except ImportError as e:
        msg = (
            "transformers (or a dependency) is not installed. "
            f"Install requirements.txt before starting the server: {e}"
        )
        LOGGER.error(msg)
        _record_load_failure(msg)
        raise ModelLoadError(msg) from e

    tokenizer = None
    model = None
    generation_config = None

    try:
        LOGGER.info("Loading tokenizer from %s", ASSETS_DIR)
        tokenizer = AutoTokenizer.from_pretrained(str(ASSETS_DIR))
    except Exception as e:
        msg = f"Failed to load tokenizer from {ASSETS_DIR}: {e}"
        LOGGER.exception("Tokenizer load failed")
        _record_load_failure(msg)
        raise ModelLoadError(msg) from e

    try:
        LOGGER.info("Loading model weights from %s", ASSETS_DIR)
        model = AutoModelForSeq2SeqLM.from_pretrained(str(ASSETS_DIR))
    except Exception as e:
        msg = (
            f"Failed to load model weights from {ASSETS_DIR}. "
            f"Ensure config + weight files (e.g. model.safetensors) are present: {e}"
        )
        LOGGER.exception("Model weights load failed")
        _record_load_failure(msg)
        raise ModelLoadError(msg) from e

    try:
        generation_config = GenerationConfig.from_pretrained(str(ASSETS_DIR))
    except OSError:
        generation_config = getattr(model, "generation_config", None)
        LOGGER.warning("No generation_config.json; using model defaults")

    _tokenizer = tokenizer
    _model = model
    _generation_config = generation_config
    _terminal_model_status(True, f"assets={ASSETS_DIR}")


def convert_singlish(text: str) -> str:
    _load_model()
    import torch

    text = (text or "").strip()
    if not text:
        return ""

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    try:
        _model.to(device)
        _model.eval()
    except Exception as e:
        LOGGER.exception("Moving model to %s failed", device)
        raise RuntimeError(f"Inference device setup failed ({device}): {e}") from e

    enc = _tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        max_length=512,
    )
    enc = {k: v.to(device) for k, v in enc.items()}

    gen_kw = {}
    if _generation_config is not None:
        gen_kw["generation_config"] = _generation_config

    with torch.no_grad():
        out = _model.generate(**enc, **gen_kw)

    decoded = _tokenizer.decode(out[0], skip_special_tokens=True)
    return decoded.strip()


@_app.route("/health", methods=["GET"])
def health():
    payload = {
        "ok": True,
        "assets": str(ASSETS_DIR),
        "model_loaded": _model is not None,
    }
    if _model_load_error:
        payload["model_load_error"] = _model_load_error
    return jsonify(payload)


@_app.route("/convert", methods=["POST"])
def convert():
    payload = request.get_json(silent=True) or {}
    text = payload.get("text", "")
    if not isinstance(text, str):
        return jsonify({"error": "field `text` must be a string"}), 400
    try:
        sinhala = convert_singlish(text)
        return jsonify({"sinhala": sinhala})
    except ModelLoadError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        LOGGER.exception("Conversion failed")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    _terminal_model_status(
        False,
        f"lazy load on first /convert; GET http://127.0.0.1:{DEFAULT_PORT}/health for JSON status",
    )
    _app.run(host="0.0.0.0", port=DEFAULT_PORT, threaded=False)
