"""One-time model pre-download script.

Run this ONCE on an internet-connected machine before deploying offline:

    uv run python download_models.py

Models are cached to ~/.cache/huggingface/hub/
Copy that directory to the offline machine at the same path.
After copying, set HF_HUB_OFFLINE=1 in the environment to prevent
any accidental network calls during ingestion.
"""

import sys


def download_yolo_layout():
    """YOLO layout detection model used by Unstructured hi_res strategy."""
    from huggingface_hub import hf_hub_download
    models = [
        "yolox_l0.05.onnx",
        "yolox_tiny.onnx",
        "yolox_l0.05_quantized.onnx",
    ]
    print("Downloading Unstructured YOLO layout models...")
    for filename in models:
        path = hf_hub_download(
            repo_id="unstructuredio/yolo_x_layout",
            filename=filename,
        )
        print(f"  ✓ {filename} → {path}")


def download_table_transformer():
    """Table structure recognition model used by Unstructured infer_table_structure."""
    from transformers import DetrImageProcessor, TableTransformerForObjectDetection
    model_id = "microsoft/table-transformer-structure-recognition"
    print(f"Downloading {model_id}...")
    DetrImageProcessor.from_pretrained(model_id)
    TableTransformerForObjectDetection.from_pretrained(model_id)
    print(f"  ✓ {model_id}")


def download_embedding_model():
    """BGE-M3 embedding model — primary multilingual model for Tamil/English."""
    from sentence_transformers import SentenceTransformer
    model_id = "BAAI/bge-m3"
    print(f"Downloading {model_id} (~2.3 GB)...")
    SentenceTransformer(model_id)
    print(f"  ✓ {model_id}")


def print_offline_instructions():
    import os
    hf_cache = os.path.expanduser("~/.cache/huggingface/hub")
    print("\n" + "=" * 60)
    print("Download complete.")
    print(f"\nModels cached at:\n  {hf_cache}")
    print("\nTo deploy offline:")
    print(f"  1. Copy {hf_cache}/ to the offline machine at the same path")
    print("  2. Set this env var before running ingestion:")
    print("       export HF_HUB_OFFLINE=1")
    print("     Or add it to packages/ingestion/.env")
    print("=" * 60)


if __name__ == "__main__":
    steps = [
        download_yolo_layout,
        download_table_transformer,
        download_embedding_model,
    ]
    failed = []
    for step in steps:
        try:
            step()
        except Exception as e:
            print(f"  ✗ {step.__name__} failed: {e}", file=sys.stderr)
            failed.append(step.__name__)

    print_offline_instructions()
    if failed:
        print(f"\nFailed: {', '.join(failed)}", file=sys.stderr)
        sys.exit(1)
