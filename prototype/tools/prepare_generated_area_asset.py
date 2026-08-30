#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Prepare AI-generated public-area building art for the game.

The built-in image generator occasionally returns an RGB image that *draws* a
checkerboard instead of returning a real alpha channel.  This tool performs a
strictly mechanical finishing pass only:

* identify the neutral, bright checkerboard connected to the canvas edge;
* convert that background to alpha without repainting the building;
* trim and fit the cut-out on a 768 x 768 transparent canvas;
* save a compact RGBA WebP suitable for the runtime asset pipeline.

It intentionally does not alter hue, contrast, geometry, or painted content.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Tuple

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, label


DEFAULT_CANVAS = 768
DEFAULT_PADDING = 46
DEFAULT_QUALITY = 88
BACKGROUND_MIN_CHANNEL = 226
BACKGROUND_MAX_CHROMA = 34
MIN_ENCLOSED_BACKGROUND_AREA = 96


def _checkerboard_background(rgb: np.ndarray) -> np.ndarray:
    """Return the rendered checkerboard pixels that should become transparent.

    Background selection is based on connected components, not a global white
    key, so enclosed pale highlights painted on the building remain intact.
    Large enclosed neutral components are also removed because they represent
    checkerboard visible through open windows or pavilion gaps.
    """

    rgb16 = rgb.astype(np.int16, copy=False)
    minimum = rgb16.min(axis=2)
    maximum = rgb16.max(axis=2)
    chroma = maximum - minimum
    background_like = (
        (minimum >= BACKGROUND_MIN_CHANNEL)
        & (chroma <= BACKGROUND_MAX_CHROMA)
    )

    components, count = label(background_like, structure=np.ones((3, 3), dtype=bool))
    if count == 0:
        return np.zeros(background_like.shape, dtype=bool)

    sizes = np.bincount(components.ravel())
    border_ids = np.unique(
        np.concatenate(
            (
                components[0, :],
                components[-1, :],
                components[:, 0],
                components[:, -1],
            )
        )
    )
    keep_ids = set(int(value) for value in border_ids if value != 0)
    keep_ids.update(
        index
        for index, size in enumerate(sizes)
        if index != 0 and size >= MIN_ENCLOSED_BACKGROUND_AREA
    )
    return np.isin(components, np.fromiter(keep_ids, dtype=np.int32))


def _largest_subject(mask: np.ndarray) -> np.ndarray:
    """Remove isolated generator specks while retaining the main building."""

    components, count = label(mask, structure=np.ones((3, 3), dtype=bool))
    if count == 0:
        raise ValueError("No foreground subject was detected")
    sizes = np.bincount(components.ravel())
    sizes[0] = 0
    subject_id = int(np.argmax(sizes))
    subject = components == subject_id
    if int(subject.sum()) < max(64, mask.size // 200):
        raise ValueError("Detected foreground is too small to be a building asset")
    return subject


def extract_rgba(image: Image.Image) -> Image.Image:
    """Convert a rendered-checker RGB image to a clean RGBA cut-out."""

    rgb_image = image.convert("RGB")
    rgb = np.asarray(rgb_image, dtype=np.uint8)
    background = _checkerboard_background(rgb)
    subject = _largest_subject(~background)

    # Build a soft one-to-two pixel edge from the real pixel/background colour
    # difference.  Interior pixels remain exactly as generated.
    distance, nearest_background = distance_transform_edt(
        subject,
        return_indices=True,
    )
    nearest_rgb = rgb[
        nearest_background[0],
        nearest_background[1],
    ].astype(np.float32)
    difference = np.linalg.norm(rgb.astype(np.float32) - nearest_rgb, axis=2)
    evidence = np.clip(difference / 38.0, 0.0, 1.0)
    coverage = np.clip((distance - 0.35) / 1.45, 0.0, 1.0)
    alpha = np.where(subject, np.maximum(evidence, coverage), 0.0)
    alpha[distance >= 1.8] = 1.0
    alpha_u8 = np.rint(alpha * 255.0).astype(np.uint8)

    # Decontaminate semi-transparent boundary RGB.  Generated checker/white
    # pixels otherwise survive inside the anti-aliased fringe as a bright halo
    # when the sprite is rendered on the game's dark scene backgrounds.
    interior = distance >= 1.8
    _, nearest_interior = distance_transform_edt(
        ~interior,
        return_indices=True,
    )
    clean_rgb = rgb.copy()
    partial = subject & (alpha_u8 < 255)
    clean_rgb[partial] = rgb[
        nearest_interior[0][partial],
        nearest_interior[1][partial],
    ]

    rgba = np.zeros((*rgb.shape[:2], 4), dtype=np.uint8)
    rgba[:, :, :3] = clean_rgb
    rgba[:, :, 3] = alpha_u8
    rgba[alpha_u8 == 0, :3] = 0
    return Image.fromarray(rgba, mode="RGBA")


def _alpha_bbox(image: Image.Image, threshold: int = 2) -> Tuple[int, int, int, int]:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if xs.size == 0:
        raise ValueError("Prepared image has no visible pixels")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _premultiplied_resize(image: Image.Image, size: Tuple[int, int]) -> Image.Image:
    """Resize RGBA without introducing white RGB fringes at transparent edges."""

    return image.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def fit_transparent_canvas(
    image: Image.Image,
    canvas: int = DEFAULT_CANVAS,
    padding: int = DEFAULT_PADDING,
) -> Image.Image:
    """Tightly crop and proportionally fit a cut-out to a square canvas."""

    if canvas <= 0:
        raise ValueError("canvas must be positive")
    if padding < 0 or padding * 2 >= canvas:
        raise ValueError("padding must leave a positive drawable area")

    left, top, right, bottom = _alpha_bbox(image)
    cropped = image.crop((left, top, right, bottom))
    drawable = canvas - padding * 2
    scale = min(drawable / cropped.width, drawable / cropped.height)
    width = max(1, int(round(cropped.width * scale)))
    height = max(1, int(round(cropped.height * scale)))
    resized = _premultiplied_resize(cropped, (width, height))

    result = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    x = (canvas - width) // 2
    y = (canvas - height) // 2
    result.alpha_composite(resized, (x, y))
    return result


def prepare_asset(
    source: Path,
    destination: Path,
    canvas: int = DEFAULT_CANVAS,
    padding: int = DEFAULT_PADDING,
    quality: int = DEFAULT_QUALITY,
) -> Dict[str, Any]:
    """Prepare one source image and return its machine-readable QA report."""

    if not source.is_file():
        raise FileNotFoundError(source)
    if not 1 <= quality <= 100:
        raise ValueError("quality must be between 1 and 100")

    with Image.open(source) as original:
        prepared = fit_transparent_canvas(extract_rgba(original), canvas, padding)

    destination.parent.mkdir(parents=True, exist_ok=True)
    prepared.save(
        destination,
        "WEBP",
        quality=quality,
        method=6,
        exact=True,
    )
    return inspect_asset(destination)


def inspect_asset(path: Path) -> Dict[str, Any]:
    """Return dimensions, alpha coverage, corners, size, and SHA-256."""

    payload = path.read_bytes()
    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
        corner_alpha = [
            int(alpha[0, 0]),
            int(alpha[0, -1]),
            int(alpha[-1, 0]),
            int(alpha[-1, -1]),
        ]
        visible = alpha > 0
        partial = (alpha > 0) & (alpha < 255)
        bbox = _alpha_bbox(rgba, threshold=0)
        return {
            "path": str(path),
            "format": image.format,
            "mode": image.mode,
            "width": image.width,
            "height": image.height,
            "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "alphaMin": int(alpha.min()),
            "alphaMax": int(alpha.max()),
            "cornerAlpha": corner_alpha,
            "visibleFraction": round(float(visible.mean()), 6),
            "partialAlphaFraction": round(float(partial.mean()), 6),
            "visibleBounds": list(bbox),
        }


def _self_test() -> Dict[str, Any]:
    """Exercise checker extraction, edge alpha, fitting, and WebP inspection."""

    size = 256
    tile = 16
    board = Image.new("RGB", (size, size), (254, 254, 254))
    pixels = np.asarray(board).copy()
    yy, xx = np.indices((size, size))
    dark = ((xx // tile) + (yy // tile)) % 2 == 1
    pixels[dark] = (242, 242, 242)
    board = Image.fromarray(pixels, mode="RGB")
    draw = ImageDraw.Draw(board)
    draw.rounded_rectangle((54, 68, 202, 196), radius=18, fill=(137, 72, 32), outline=(39, 32, 27), width=5)
    draw.rectangle((88, 105, 166, 174), fill=(202, 132, 61))
    draw.ellipse((121, 126, 127, 132), fill=(252, 252, 252))

    extracted = extract_rgba(board)
    prepared = fit_transparent_canvas(extracted)
    alpha = np.asarray(prepared.getchannel("A"), dtype=np.uint8)
    assert prepared.size == (DEFAULT_CANVAS, DEFAULT_CANVAS)
    assert all(int(value) == 0 for value in (alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]))
    assert int(alpha.max()) == 255
    assert np.any((alpha > 0) & (alpha < 255))
    assert 0.1 < float((alpha > 0).mean()) < 0.8
    return {
        "status": "PASS",
        "canvas": list(prepared.size),
        "visibleFraction": round(float((alpha > 0).mean()), 6),
        "partialAlphaFraction": round(float(((alpha > 0) & (alpha < 255)).mean()), 6),
    }


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True))


def _paths(values: Iterable[str]) -> Iterable[Path]:
    for value in values:
        yield Path(value).expanduser().resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", help="RGB/RGBA source image")
    parser.add_argument("destination", nargs="?", help="destination .webp")
    parser.add_argument("--canvas", type=int, default=DEFAULT_CANVAS)
    parser.add_argument("--padding", type=int, default=DEFAULT_PADDING)
    parser.add_argument("--quality", type=int, default=DEFAULT_QUALITY)
    parser.add_argument("--inspect", nargs="+", metavar="PATH")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        _print_json(_self_test())
        return 0
    if args.inspect:
        _print_json([inspect_asset(path) for path in _paths(args.inspect)])
        return 0
    if not args.source or not args.destination:
        raise SystemExit("source and destination are required unless --inspect or --self-test is used")

    report = prepare_asset(
        Path(args.source).expanduser().resolve(),
        Path(args.destination).expanduser().resolve(),
        canvas=args.canvas,
        padding=args.padding,
        quality=args.quality,
    )
    _print_json(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
