"""Create v14 diff/overlay artifacts and emit machine-readable metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance
from skimage.metrics import structural_similarity


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("design", type=Path)
    parser.add_argument("actual", type=Path)
    parser.add_argument("diff", type=Path)
    parser.add_argument("overlay", type=Path)
    parser.add_argument("--pixel-threshold", type=int, default=18)
    args = parser.parse_args()

    design = Image.open(args.design).convert("RGB")
    actual = Image.open(args.actual).convert("RGB")
    if design.size != actual.size:
        raise SystemExit(f"size mismatch: design={design.size}, actual={actual.size}")

    design_array = np.asarray(design, dtype=np.uint8)
    actual_array = np.asarray(actual, dtype=np.uint8)
    identical = bool(np.array_equal(design_array, actual_array))
    if identical:
        ratio = 0.0
        ssim = 1.0
    else:
        absolute = np.abs(design_array.astype(np.int16) - actual_array.astype(np.int16))
        different = np.max(absolute, axis=2) > args.pixel_threshold
        ratio = float(np.count_nonzero(different) / different.size)
        ssim = float(
            structural_similarity(
                design_array,
                actual_array,
                multichannel=True,
                data_range=255,
            )
        )

    args.diff.parent.mkdir(parents=True, exist_ok=True)
    args.overlay.parent.mkdir(parents=True, exist_ok=True)
    diff = Image.new("RGB", design.size) if identical else ImageChops.difference(design, actual)
    ImageEnhance.Contrast(diff).enhance(3.0).save(args.diff, optimize=True)
    (design if identical else Image.blend(design, actual, 0.5)).save(args.overlay, optimize=True)
    print(json.dumps({"ssim": ssim, "differentPixelRatio": ratio, "width": design.width, "height": design.height}))


if __name__ == "__main__":
    main()
