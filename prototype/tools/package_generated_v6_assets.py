#!/usr/bin/env python3
"""Package reviewed v6 H5 generation sheets into release WebP assets.

The generator preserves each original sheet under assets/art/source_v6,
segments only at deterministic equal-width gutters, repairs the two sheets
whose provider baked a light checkerboard, and records hashes/sizes/alpha.
It never reads credentials or calls an image API.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "prototype" / "assets" / "art"
GENERATED = Path.home() / ".codex" / "generated_images" / "019ff5af-e303-76f3-b2fa-39efe676ec61"

SHEETS = {
    "building_clinic": "exec-8e92e7dd-64b5-487b-9370-783feab34648.png",
    "building_herb": "exec-3410c3e3-c0c3-49d3-8cf0-d0d2aa9131a1.png",
    "building_groom": "exec-76600cef-38fa-42c4-b6c4-e1b38c9db9c1.png",
    "building_play": "exec-889b3a64-5871-4573-aa4e-cff0aced7e34.png",
    "fox_forms": "exec-b0892ef2-82a4-4dcb-bab9-89e2093a50fb.png",
    "background_fox_lantern": "exec-f2663f0c-e90b-41ac-a1d7-4b68c8c2b0d0.png",
    "icons_herb": "exec-b9b07176-a1f8-4466-bc01-a149b843d8cc.png",
    "icons_tool": "exec-0d58dc45-0dfb-4b0c-9e70-3e81a3729db6.png",
    "icons_feed": "exec-72fe677d-4f41-4dee-badc-746fab32c51f.png",
    "icons_groom": "exec-e980d666-47ff-47fe-b507-660e2cd8d74e.png",
    "icons_play": "exec-de1d287a-d693-4c2f-9ef9-dd96e77d55fc.png",
}

PROMPTS = {
    "buildings": "Three same-camera upgrade variants; Lv1 compact, Lv2 expanded, Lv3 celestial; transparent Shanhaijing watercolor cutouts.",
    "fox_forms": "Five cute nine-tailed-fox evolutions with 1/3/5/7/9 tails, increasing costume detail, fixed identity/camera/baseline.",
    "icons": "Six high-contrast merge tiers per family with family color, distinct silhouette and redundant pip shape; transparent mobile icons.",
    "background": "Fox Lantern Night building-free portrait courtyard with four empty bases, pond/path perspective and warm fox lanterns.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def repair_light_checkerboard(image: Image.Image) -> Image.Image:
    """Remove only bright near-neutral pixels connected to the image border."""
    rgb = np.asarray(image.convert("RGB"))
    high = rgb.min(axis=2) >= 235
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 12
    candidate = high & neutral
    height, width = candidate.shape
    background = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        if candidate[0, x]: queue.append((0, x))
        if candidate[height - 1, x]: queue.append((height - 1, x))
    for y in range(height):
        if candidate[y, 0]: queue.append((y, 0))
        if candidate[y, width - 1]: queue.append((y, width - 1))
    while queue:
        y, x = queue.popleft()
        if background[y, x] or not candidate[y, x]:
            continue
        background[y, x] = True
        if y: queue.append((y - 1, x))
        if y + 1 < height: queue.append((y + 1, x))
        if x: queue.append((y, x - 1))
        if x + 1 < width: queue.append((y, x + 1))
    alpha = np.where(background, 0, 255).astype(np.uint8)
    rgba = np.dstack([rgb, alpha])
    return Image.fromarray(rgba, "RGBA")


def rgba_sheet(name: str) -> Image.Image:
    image = Image.open(GENERATED / SHEETS[name])
    if "A" in image.getbands():
        return image.convert("RGBA")
    return repair_light_checkerboard(image)


def crop_segment(sheet: Image.Image, index: int, count: int) -> Image.Image:
    left = round(sheet.width * index / count)
    right = round(sheet.width * (index + 1) / count)
    segment = sheet.crop((left, 0, right, sheet.height))
    bbox = segment.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"segment {index + 1}/{count} has no visible pixels")
    return segment.crop(bbox)


def contain(source: Image.Image, size: tuple[int, int], max_size: tuple[int, int], anchor_y: float) -> Image.Image:
    source = source.convert("RGBA")
    ratio = min(max_size[0] / source.width, max_size[1] / source.height)
    resized = source.resize((max(1, round(source.width * ratio)), max(1, round(source.height * ratio))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - resized.width) // 2
    baseline = round(size[1] * anchor_y)
    y = min(size[1] - resized.height, baseline - resized.height)
    canvas.alpha_composite(resized, (x, max(0, y)))
    return canvas


def save_webp(image: Image.Image, path: Path, quality: int = 86) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "WEBP", quality=quality, method=6, exact=True)
    if path.stat().st_size > 1024 * 1024:
        image.save(path, "WEBP", quality=72, method=6, exact=True)
    if path.stat().st_size > 1024 * 1024:
        raise RuntimeError(f"{path} exceeds 1 MiB")


def build_atlas(portrait: Image.Image, level: int) -> Image.Image:
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    scales = [0.88, 0.90, 0.93, 0.90, 0.88, 0.91, 0.94, 0.91,
              0.88, 0.92, 0.95, 0.92, 0.89, 0.93, 0.96, 0.93]
    offsets = [(0, 5), (2, 1), (0, -3), (-2, 1), (-5, 3), (-1, 0),
               (5, -2), (1, 0), (-7, 2), (-2, -1), (7, -3), (2, -1),
               (-4, 4), (0, 0), (4, -5), (0, 0)]
    for frame in range(16):
        cell = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        sprite = portrait if frame % 8 < 6 else ImageOps.mirror(portrait)
        scale = scales[frame] * (0.98 + level * 0.004)
        width = max(1, round(sprite.width * scale * 232 / max(sprite.width, sprite.height)))
        height = max(1, round(sprite.height * scale * 232 / max(sprite.width, sprite.height)))
        resized = sprite.resize((width, height), Image.Resampling.LANCZOS)
        x = (256 - width) // 2 + offsets[frame][0]
        y = 244 - height + offsets[frame][1]
        cell.alpha_composite(resized, (x, y))
        atlas.alpha_composite(cell, ((frame % 4) * 256, (frame // 4) * 256))
    return atlas


def alpha_stats(image: Image.Image) -> dict[str, int | list[int]]:
    alpha = np.asarray(image.convert("RGBA"))[:, :, 3]
    return {
        "alpha_min": int(alpha.min()),
        "alpha_max": int(alpha.max()),
        "transparent_pixels": int((alpha == 0).sum()),
        "dimensions": [image.width, image.height],
    }


def main() -> None:
    missing = [str(GENERATED / value) for value in SHEETS.values() if not (GENERATED / value).is_file()]
    if missing:
        raise SystemExit("Missing reviewed generation sheets: " + ", ".join(missing))

    raw_dir = ART / "source_v6"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for name, filename in SHEETS.items():
        shutil.copy2(GENERATED / filename, raw_dir / f"{name}.png")

    outputs: list[dict[str, object]] = []

    for family in ("herb", "tool", "feed", "groom", "play"):
        sheet = rgba_sheet(f"icons_{family}")
        for tier in range(1, 7):
            icon = contain(crop_segment(sheet, tier - 1, 6), (256, 256), (228, 228), 0.92)
            path = ART / "match3" / f"{family}_{tier:02d}.webp"
            save_webp(icon, path, 88)
            outputs.append({"kind": "icon", "id": f"{family}_{tier:02d}", "path": str(path.relative_to(ROOT)).replace("\\", "/"), **alpha_stats(icon)})

    for building in ("clinic", "herb", "groom", "play"):
        sheet = rgba_sheet(f"building_{building}")
        for level in range(1, 4):
            art = contain(crop_segment(sheet, level - 1, 3), (768, 768), (720, 650), 0.92)
            path = ART / "buildings" / f"{building}_lv{level}.webp"
            save_webp(art, path, 84)
            outputs.append({"kind": "building", "id": f"{building}_lv{level}", "path": str(path.relative_to(ROOT)).replace("\\", "/"), **alpha_stats(art)})

    fox_sheet = rgba_sheet("fox_forms")
    for level in range(1, 6):
        portrait = contain(crop_segment(fox_sheet, level - 1, 5), (512, 512), (464, 464), 0.94)
        portrait_path = ART / "characters" / f"jiuweihu_lv{level}.webp"
        save_webp(portrait, portrait_path, 88)
        atlas = build_atlas(portrait, level)
        atlas_path = ART / "characters" / f"jiuweihu_lv{level}_atlas.webp"
        save_webp(atlas, atlas_path, 82)
        outputs.append({"kind": "fox-portrait", "id": f"jiuweihu_lv{level}", "path": str(portrait_path.relative_to(ROOT)).replace("\\", "/"), **alpha_stats(portrait)})
        outputs.append({"kind": "fox-atlas", "id": f"jiuweihu_lv{level}_atlas", "path": str(atlas_path.relative_to(ROOT)).replace("\\", "/"), **alpha_stats(atlas)})

    background = Image.open(GENERATED / SHEETS["background_fox_lantern"]).convert("RGB")
    background.thumbnail((1080, 1350), Image.Resampling.LANCZOS)
    background_path = ART / "scenes" / "bg_fox_lantern_buildingfree.webp"
    save_webp(background, background_path, 78)
    outputs.append({"kind": "background", "id": "fox-lantern-night", "path": str(background_path.relative_to(ROOT)).replace("\\", "/"), "dimensions": [background.width, background.height]})

    for item in outputs:
        path = ROOT / str(item["path"])
        item["bytes"] = path.stat().st_size
        item["sha256"] = sha256(path)

    manifest = {
        "schema": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": "reviewed-imagegen-fallback-after-seedream-401",
        "seedream": {
            "model": "doubao-seedream-5-0-lite-260128",
            "endpoint": "https://ark.cn-beijing.volces.com/api/v3/images/generations",
            "status": "credential-rejected-http-401",
            "credentialIncluded": False,
        },
        "prompts": PROMPTS,
        "sourceSheets": [
            {"id": name, "path": f"prototype/assets/art/source_v6/{name}.png", "sha256": sha256(raw_dir / f"{name}.png")}
            for name in SHEETS
        ],
        "outputs": outputs,
    }
    manifest_path = ART / "v6_asset_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Packaged {len(outputs)} v6 release assets -> {manifest_path}")


if __name__ == "__main__":
    main()
