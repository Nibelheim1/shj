#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate and validate the v6 H5 growth assets.

The script is deliberately resumable.  It keeps Seedream's source PNGs below
``v6_staging/{icons,buildings}/raw`` and writes only post-processed WebP files
next to them.  API credentials are read from the environment, then the local
Codex auth file; they are never printed or written to the manifest.

Examples::

    python prototype/tools/generate_h5_growth_assets.py --all --workers 2
    python prototype/tools/generate_h5_growth_assets.py --check
    python prototype/tools/generate_h5_growth_assets.py --dry-run
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
import sys
import time
from collections import deque
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import requests
from PIL import Image, ImageDraw


MODEL = "doubao-seedream-5-0-lite-260128"
ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
PROMPT_VERSION = "h5-growth-v6-staging-2026-08-13"
MAX_FORMAL_BYTES = 1024 * 1024

ROOT = Path(__file__).resolve().parents[2]
STAGING = ROOT / "prototype" / "assets" / "art" / "v6_staging"
ICON_DIR = STAGING / "icons"
BUILDING_DIR = STAGING / "buildings"
ICON_RAW_DIR = ICON_DIR / "raw"
BUILDING_RAW_DIR = BUILDING_DIR / "raw"
MANIFEST_PATH = STAGING / "asset_manifest.json"

# Existing art is used as a style reference only.  These paths are kept in the
# manifest so a reviewer can reproduce the exact frozen prompt set.
ICON_REFS = {
    "herb": ROOT / "prototype" / "assets" / "art" / "match3" / "herb_01.png",
    "tool": ROOT / "prototype" / "assets" / "art" / "match3" / "tool_01.png",
    "food": ROOT / "prototype" / "assets" / "art" / "match3" / "feed_01.png",
    "groom": ROOT / "prototype" / "assets" / "art" / "match3" / "groom_01.png",
    "play": ROOT / "prototype" / "assets" / "art" / "match3" / "play_01.png",
}
BUILDING_REFS = {
    "clinic": ROOT / "prototype" / "assets" / "art" / "buildings" / "clinic.webp",
    "herb": ROOT / "prototype" / "assets" / "art" / "buildings" / "herb.webp",
    "groom": ROOT / "prototype" / "assets" / "art" / "buildings" / "groom.webp",
    "play": ROOT / "prototype" / "assets" / "art" / "buildings" / "play.webp",
}

FAMILY_COLORS = {
    "herb": (104, 176, 112),
    "tool": (72, 137, 198),
    "food": (235, 145, 62),
    "groom": (145, 94, 190),
    "play": (214, 54, 126),
}

FAMILY_LABELS = {
    "herb": "green herbal remedy",
    "tool": "blue apothecary tool",
    "food": "orange nourishing food",
    "groom": "purple grooming item",
    "play": "rose-magenta play toy",
}

# Frozen level descriptions.  Shape, material, and silhouette evolve in a
# predictable direction; all prompts explicitly forbid text so generated
# corner badges can be added deterministically after cutout.
ICON_LEVELS = {
    "herb": [
        "one fresh mint leaf with a single vein",
        "a small sprig with two rounded mint leaves",
        "a tied bundle of three medicinal leaves",
        "a tiny ceramic herb jar with a leaf sprig",
        "a lidded jade medicine jar with two leaves and a ginseng root",
        "an ornate green apothecary chest overflowing with layered herbs and a jade seal",
    ],
    "tool": [
        "one small blue glass medicine dropper",
        "a blue ceramic mortar with a short pestle",
        "a blue medicine bottle with stopper and measuring spoon",
        "a compact blue apothecary scale with two pans",
        "a blue bronze kettle with spout, ladle and medicine vial",
        "a refined blue apothecary workstation with retort, bottles and a glowing rune stone",
    ],
    "food": [
        "one warm orange rice ball",
        "a small orange steamed bun with one leaf garnish",
        "a round orange bowl of congee with a spoon",
        "an orange bamboo lunch box with rice and vegetable garnish",
        "a generous orange hot-pot bowl with mushrooms and two side dishes",
        "an ornate orange banquet tray with soup, rice, fruit and flower garnish",
    ],
    "groom": [
        "one small purple wooden comb",
        "a rounded purple hairbrush with soft bristles",
        "a purple comb and tiny jade grooming cloth",
        "a purple grooming kit with brush, comb and ribbon",
        "a lacquered purple vanity box with brush, comb and folded towel",
        "an ornate purple grooming chest with brush, comb, perfume vial and silk ribbon",
    ],
    "play": [
        "one simple rose-magenta cloth ball",
        "a rose-magenta feather toy on a short cord",
        "a rose-magenta yarn ball with trailing string",
        "a rose-magenta wind chime toy with two bells",
        "a rose-magenta kite toy with tassels and a wooden spool",
        "an ornate rose-magenta play set with kite, bells, ribbon and a tiny drum",
    ],
}

BUILDING_LEVELS = {
    "clinic": [
        "Lv1: a compact warm timber clinic hut, one blue-grey tiled roof, open consultation window, one herb shelf and a small paper lantern",
        "Lv2: the same clinic hut and locked camera, visibly expanded roof eaves and front porch, more medicine shelves, two lanterns and a stone step",
        "Lv3: the same clinic hut and locked camera, a larger but still compact clinic with layered roof trim, side apothecary cabinet, covered porch, three lanterns and a tiny medicinal garden",
    ],
    "herb": [
        "Lv1: a compact timber herb-drying shed, one blue-grey tiled roof, hanging herb bundles and one wooden planter",
        "Lv2: the same herb shed and locked camera, expanded drying rack and awning, additional hanging herb bundles, two planters and a small water trough",
        "Lv3: the same herb shed and locked camera, larger drying garden with layered roof trim, multiple racks, baskets of herbs, planters and a small stone irrigation basin",
    ],
    "groom": [
        "Lv1: a compact timber grooming pavilion, one blue-grey tiled roof, green curtain, low grooming bench, comb basket and one lantern",
        "Lv2: the same grooming pavilion and locked camera, expanded side deck and curtain, a second bench, folded towels, comb basket and two lanterns",
        "Lv3: the same grooming pavilion and locked camera, larger decorated deck with layered roof trim, mirror stand, towel shelves, bamboo plant and three lanterns",
    ],
    "play": [
        "Lv1: a compact open timber play pavilion, one teal glazed roof, soft cushion, one hanging bell and one cloth toy",
        "Lv2: the same play pavilion and locked camera, expanded deck and eaves, two cushions, two hanging bells, a kite and a toy drum",
        "Lv3: the same play pavilion and locked camera, larger decorated deck with layered roof trim, cushions, bells, kite, toy drum, streamers and a small spinning pinwheel",
    ],
}

COMMON_ICON_PROMPT = (
    "Use case: game-match3-icon. Asset type: transparent 2D board token. "
    "Create one centered standalone object, fully inside a square frame with generous padding. "
    "Chinese Shanhai Jing healing-game art matching the supplied reference: cute hand-painted watercolor and gouache, "
    "soft rounded chibi silhouette, warm brown 2px outline, subtle paper grain, low-saturation warm highlights. "
    "The family color must dominate the object ({family_label}); keep family color consistent across all six levels. "
    "No cast shadow, no floor, no reflection, no character, no animal, no text, no letters, no numbers, no watermark, no logo. "
    "Place the object on a perfectly flat solid #ff00ff chroma-key background with no gradient or texture. "
    "Do not use #ff00ff in the object. The final icon will receive a deterministic top-right corner pip badge after cutout."
)

COMMON_BUILDING_PROMPT = (
    "Use case: game-building-sprite. Asset type: transparent 2D courtyard building sprite. "
    "Match the supplied existing building reference exactly in style: cute Chinese Shanhai Jing healing courtyard, "
    "hand-painted watercolor/gouache, warm timber, rounded shapes, warm brown ink outline, soft paper texture, "
    "slightly elevated three-quarter view, upper-left key light, readable at 100px. "
    "Lock the camera, perspective, footprint, bottom base anchor at 92% canvas height, and center x anchor at 50% for all levels. "
    "Upgrade only by adding scale within the same footprint, roof trim, awnings, functional props and small decorations; do not change the building identity. "
    "No people, no animals, no text, no letters, no numbers, no logo, no UI, no cast shadow outside the object. "
    "Place the object on a perfectly flat solid #ff00ff chroma-key background with no gradient or texture. "
    "Do not use #ff00ff in the object."
)


def rel_path(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def _read_api_key() -> Optional[str]:
    """Read a key in the requested order without ever logging its value."""
    for env_name in ("VOLCENGINE_ARK_API_KEY", "OPENAI_API_KEY"):
        value = os.environ.get(env_name)
        if value:
            return value.strip()
    auth_path = Path.home() / ".codex" / "auth.json"
    try:
        data = json.loads(auth_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    value = data.get("OPENAI_API_KEY") if isinstance(data, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def _sha256(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_dump(data: Dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(MANIFEST_PATH)


def _reference_data_uri(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    try:
        source = Image.open(path).convert("RGBA")
        # References in the repository are transparent sprites.  Flatten them
        # onto white for the API so the reference itself does not look like a
        # black-background composition to Seedream.
        if source.getchannel("A").getextrema()[0] < 255:
            white = Image.new("RGBA", source.size, (255, 255, 255, 255))
            white.alpha_composite(source)
            source = white
        image = source.convert("RGB")
        max_edge = 1024
        if max(image.size) > max_edge:
            scale = max_edge / max(image.size)
            image = image.resize((max(1, round(image.width * scale)), max(1, round(image.height * scale))), Image.LANCZOS)
        buf = BytesIO()
        image.save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except (OSError, ValueError):
        return None


def _request_image(prompt: str, reference: Optional[Path], key: str, timeout: int = 180) -> Image.Image:
    body: Dict[str, Any] = {
        "model": MODEL,
        "prompt": prompt,
        "size": "1024x1024",
        "n": 1,
        "response_format": "url",
        "output_format": "png",
        "watermark": False,
    }
    if reference:
        data_uri = _reference_data_uri(reference)
        if data_uri:
            body["image"] = data_uri
    response = requests.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    if response.status_code != 200:
        # Do not include response text: some gateways echo authorization data.
        raise RuntimeError(f"Seedream HTTP {response.status_code}")
    try:
        payload = response.json()
        item = payload["data"][0]
        image_url = item.get("url") if isinstance(item, dict) else None
        b64 = item.get("b64_json") if isinstance(item, dict) else None
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Seedream response missing image data") from exc
    if image_url:
        image_response = requests.get(image_url, timeout=timeout)
        image_response.raise_for_status()
        return Image.open(BytesIO(image_response.content)).convert("RGBA")
    if b64:
        return Image.open(BytesIO(base64.b64decode(b64))).convert("RGBA")
    raise RuntimeError("Seedream response contained neither url nor b64_json")


def _connected_key_mask(rgb: np.ndarray, threshold: float = 70.0) -> np.ndarray:
    """Return only chroma pixels connected to the outer border."""
    key = np.array([255.0, 0.0, 255.0], dtype=np.float32)
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - key) ** 2, axis=2))
    candidates = distance <= threshold
    h, w = candidates.shape
    seen = np.zeros((h, w), dtype=bool)
    queue: deque[Tuple[int, int]] = deque()
    for x in range(w):
        if candidates[0, x]:
            seen[0, x] = True
            queue.append((0, x))
        if candidates[h - 1, x] and not seen[h - 1, x]:
            seen[h - 1, x] = True
            queue.append((h - 1, x))
    for y in range(h):
        if candidates[y, 0] and not seen[y, 0]:
            seen[y, 0] = True
            queue.append((y, 0))
        if candidates[y, w - 1] and not seen[y, w - 1]:
            seen[y, w - 1] = True
            queue.append((y, w - 1))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidates[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen


def remove_chroma(image: Image.Image) -> Image.Image:
    """Remove flat magenta while retaining antialiased subject edges."""
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba).copy()
    rgb = arr[:, :, :3]
    key = np.array([255.0, 0.0, 255.0], dtype=np.float32)
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - key) ** 2, axis=2))
    hard_bg = _connected_key_mask(rgb)
    alpha = np.full(hard_bg.shape, 255, dtype=np.uint8)
    alpha[hard_bg] = 0

    # A 1-pixel soft matte prevents a magenta fringe without making unrelated
    # pink subject pixels transparent.  Only pixels adjacent to outer chroma
    # are softened.
    edge = np.zeros_like(hard_bg)
    edge[:-1, :] |= hard_bg[1:, :]
    edge[1:, :] |= hard_bg[:-1, :]
    edge[:, :-1] |= hard_bg[:, 1:]
    edge[:, 1:] |= hard_bg[:, :-1]
    soft = edge & ~hard_bg
    alpha_soft = np.clip((distance[soft] - 20.0) / 75.0 * 255.0, 0, 255).astype(np.uint8)
    alpha[soft] = alpha_soft
    arr[:, :, 3] = alpha
    # Fully transparent pixels use a neutral RGB to avoid black/white fringes
    # when a browser premultiplies the WebP texture.
    arr[alpha == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def _fit_to_canvas(image: Image.Image, size: Tuple[int, int], kind: str) -> Image.Image:
    """Normalize camera/anchor while preserving transparency."""
    image = image.convert("RGBA")
    alpha = np.asarray(image)[:, :, 3]
    ys, xs = np.where(alpha > 8)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    if len(xs) == 0 or len(ys) == 0:
        return canvas
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = image.crop(bbox)
    if kind == "icon":
        max_w, max_h = int(size[0] * 0.78), int(size[1] * 0.78)
        anchor_y = int(size[1] * 0.50)
    else:
        max_w, max_h = int(size[0] * 0.90), int(size[1] * 0.88)
        anchor_y = int(size[1] * 0.92)
    scale = min(max_w / max(1, crop.width), max_h / max(1, crop.height))
    new_size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(new_size, Image.LANCZOS)
    x = (size[0] - crop.width) // 2
    y = anchor_y - crop.height if kind == "building" else (size[1] - crop.height) // 2
    y = max(0, min(size[1] - crop.height, y))
    canvas.alpha_composite(crop, (x, y))
    return canvas


def _add_icon_badge(image: Image.Image, family: str, level: int) -> Image.Image:
    image = image.copy().convert("RGBA")
    draw = ImageDraw.Draw(image)
    accent = FAMILY_COLORS[family]
    # The badge is intentionally redundant with silhouette/material: six
    # pips are unambiguous at small H5 sizes and do not rely on text rendering.
    cx, cy, radius = image.width - 30, 30, 19
    draw.ellipse((cx - radius - 2, cy - radius - 2, cx + radius + 2, cy + radius + 2), fill=(112, 76, 54, 245))
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*accent, 255))
    pip_r = 2.7
    for index in range(level):
        angle = -1.5708 + index * 6.2832 / max(1, level)
        px = cx + np.cos(angle) * 10
        py = cy + np.sin(angle) * 10
        draw.ellipse((px - pip_r, py - pip_r, px + pip_r, py + pip_r), fill=(255, 246, 218, 255))
    return image


def _save_webp(image: Image.Image, path: Path) -> Tuple[int, int]:
    """Save with a quality ladder so the formal asset never exceeds 1 MiB."""
    path.parent.mkdir(parents=True, exist_ok=True)
    quality = 90
    current = image
    while True:
        buf = BytesIO()
        current.save(buf, "WEBP", quality=quality, method=6)
        payload = buf.getvalue()
        # Keep the requested dimensions fixed; continue the quality ladder
        # down to 10 before ever considering a dimension change.  At the
        # 256²/768² targets this remains comfortably below the 1 MiB gate.
        if len(payload) <= MAX_FORMAL_BYTES or quality <= 10:
            path.write_bytes(payload)
            return len(payload), quality
        quality -= 8


def _validate(path: Path, kind: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"ok": False, "errors": []}
    if not path.exists():
        result["errors"].append("missing formal file")
        return result
    try:
        image = Image.open(path).convert("RGBA")
    except (OSError, ValueError) as exc:
        result["errors"].append(f"unreadable image: {type(exc).__name__}")
        return result
    arr = np.asarray(image)
    alpha = arr[:, :, 3]
    corners = [int(alpha[0, 0]), int(alpha[-1, 0]), int(alpha[0, -1]), int(alpha[-1, -1])]
    result.update({
        "dimensions": [image.width, image.height],
        "alpha_min": int(alpha.min()),
        "alpha_max": int(alpha.max()),
        "corner_alpha": corners,
        "opaque_ratio": round(float((alpha >= 240).mean()), 6),
        "file_bytes": path.stat().st_size,
    })
    if kind == "icon" and (image.width, image.height) != (256, 256):
        result["errors"].append("icon dimensions must be 256x256")
    if kind == "building" and (image.width, image.height) != (768, 768):
        result["errors"].append("building dimensions must be 768x768")
    if any(value > 8 for value in corners):
        result["errors"].append("transparent corners required")
    if alpha.max() < 220:
        result["errors"].append("no sufficiently opaque subject pixels")
    if path.stat().st_size > MAX_FORMAL_BYTES:
        result["errors"].append("formal WebP exceeds 1 MiB")
    # Detect obvious white/black matte immediately outside the subject.  A few
    # dark outline pixels are expected; a full opaque black/white border is not.
    near_edge = (alpha > 0) & (alpha < 96)
    if near_edge.any():
        edge_rgb = arr[:, :, :3][near_edge]
        key_dist = np.linalg.norm(edge_rgb.astype(np.float32) - np.array([255, 0, 255], dtype=np.float32), axis=1)
        result["edge_key_like_pixels"] = int((key_dist < 18).sum())
        result["edge_white_pixels"] = int(np.all(edge_rgb >= 245, axis=1).sum())
        result["edge_black_pixels"] = int(np.all(edge_rgb <= 12, axis=1).sum())
        if result["edge_key_like_pixels"] > max(8, int(near_edge.sum() * 0.15)):
            result["errors"].append("magenta fringe detected")
        if result["edge_white_pixels"] > max(8, int(near_edge.sum() * 0.20)):
            result["errors"].append("white fringe detected")
        if result["edge_black_pixels"] > max(8, int(near_edge.sum() * 0.20)):
            result["errors"].append("black fringe detected")
    result["ok"] = not result["errors"]
    return result


def _icon_tasks() -> Iterable[Dict[str, Any]]:
    for family, levels in ICON_LEVELS.items():
        for index, subject in enumerate(levels, 1):
            stem = f"{'feed' if family == 'food' else family}_{index:02d}"
            ref = ICON_REFS[family]
            prompt = COMMON_ICON_PROMPT.format(family_label=FAMILY_LABELS[family]) + f" Subject: {subject}. Level {index} of 6; keep the silhouette clearly distinct from the other levels."
            yield {
                "id": stem,
                "kind": "icon",
                "family": family,
                "level": index,
                "prompt": prompt,
                "reference": rel_path(ref),
                "reference_path": ref,
                "source_path": ICON_RAW_DIR / f"{stem}.png",
                "formal_path": ICON_DIR / f"{stem}.webp",
            }


def _building_tasks() -> Iterable[Dict[str, Any]]:
    for family, levels in BUILDING_LEVELS.items():
        for index, subject in enumerate(levels, 1):
            stem = f"{family}_lv{index}"
            ref = BUILDING_REFS[family]
            prompt = COMMON_BUILDING_PROMPT + f" Subject: {subject}. This is level {index} of 3; keep the footprint and bottom anchor identical to the reference."
            yield {
                "id": stem,
                "kind": "building",
                "family": family,
                "level": index,
                "prompt": prompt,
                "reference": rel_path(ref),
                "reference_path": ref,
                "source_path": BUILDING_RAW_DIR / f"{stem}.png",
                "formal_path": BUILDING_DIR / f"{stem}.webp",
            }


def _tasks(kind: Optional[str] = None, selected: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    values = list(_icon_tasks()) + list(_building_tasks())
    if kind:
        values = [item for item in values if item["kind"] == kind]
    if selected:
        selected_set = set(selected)
        values = [item for item in values if item["id"] in selected_set]
    return values


def _entry_base(task: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": task["id"],
        "kind": task["kind"],
        "family": task["family"],
        "level": task["level"],
        "prompt": task["prompt"],
        "reference": task["reference"],
        "source_path": rel_path(task["source_path"]),
        "formal_path": rel_path(task["formal_path"]),
        "status": "pending",
        "source_sha256": _sha256(task["source_path"]),
        "formal_sha256": _sha256(task["formal_path"]),
        "source_bytes": task["source_path"].stat().st_size if task["source_path"].exists() else None,
        "formal_bytes": task["formal_path"].stat().st_size if task["formal_path"].exists() else None,
        "validation": None,
        "error": None,
    }


def _process_one(task: Dict[str, Any], key: Optional[str], dry_run: bool, force: bool) -> Dict[str, Any]:
    entry = _entry_base(task)
    formal = task["formal_path"]
    source = task["source_path"]
    kind = task["kind"]
    if not force and formal.exists():
        entry["status"] = "existing"
        entry["validation"] = _validate(formal, kind)
        entry["formal_sha256"] = _sha256(formal)
        entry["formal_bytes"] = formal.stat().st_size
        return entry
    if dry_run:
        entry["status"] = "dry-run"
        return entry
    if not key:
        entry["status"] = "blocked"
        entry["error"] = "missing API key (set VOLCENGINE_ARK_API_KEY, OPENAI_API_KEY, or ~/.codex/auth.json)"
        return entry

    last_error = None
    for attempt in range(3):
        try:
            generated = _request_image(task["prompt"], task["reference_path"], key)
            source.parent.mkdir(parents=True, exist_ok=True)
            generated.save(source, "PNG", optimize=True)
            cutout = remove_chroma(generated)
            target_size = (256, 256) if kind == "icon" else (768, 768)
            cutout = _fit_to_canvas(cutout, target_size, kind)
            if kind == "icon":
                cutout = _add_icon_badge(cutout, task["family"], int(task["level"]))
            source.parent.mkdir(parents=True, exist_ok=True)
            formal.parent.mkdir(parents=True, exist_ok=True)
            formal_bytes, quality = _save_webp(cutout, formal)
            validation = _validate(formal, kind)
            entry.update({
                "status": "ok" if validation["ok"] else "invalid",
                "source_sha256": _sha256(source),
                "formal_sha256": _sha256(formal),
                "source_bytes": source.stat().st_size,
                "formal_bytes": formal_bytes,
                "webp_quality": quality,
                "dimensions": validation.get("dimensions"),
                "alpha": {
                    "min": validation.get("alpha_min"),
                    "max": validation.get("alpha_max"),
                    "corners": validation.get("corner_alpha"),
                    "opaque_ratio": validation.get("opaque_ratio"),
                },
                "validation": validation,
            })
            if not validation["ok"]:
                entry["error"] = "; ".join(validation["errors"])
            return entry
        except Exception as exc:  # keep the batch resumable and manifest complete
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < 2:
                time.sleep(2 ** attempt)
    entry["status"] = "failed"
    entry["error"] = last_error or "unknown generation error"
    return entry


def _new_manifest(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "schema": "h5-growth-assets-v6",
        "prompt_version": PROMPT_VERSION,
        "model": MODEL,
        "endpoint": ENDPOINT,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "references": {
            "icons": {family: rel_path(path) for family, path in ICON_REFS.items()},
            "buildings": {family: rel_path(path) for family, path in BUILDING_REFS.items()},
        },
        "constraints": {
            "icon_count": 30,
            "building_count": 12,
            "formal_max_bytes": MAX_FORMAL_BYTES,
            "icon_dimensions": [256, 256],
            "building_dimensions": [768, 768],
            "transparent_background": "#ff00ff chroma-key removed locally",
            "building_anchor": {"camera": "locked", "center_x": 0.5, "base_y": 0.92},
        },
        "execution": {
            "status": "pending",
            "api_key_available": False,
            "blocking_reason": None,
        },
        "assets": [_entry_base(task) for task in tasks],
        "summary": {"requested": len(tasks), "ok": 0, "existing": 0, "dry_run": 0, "blocked": 0, "failed": 0, "invalid": 0},
    }


def _refresh_summary(manifest: Dict[str, Any]) -> None:
    counts = {key: 0 for key in ("ok", "existing", "dry-run", "blocked", "failed", "invalid")}
    for item in manifest["assets"]:
        if item.get("status") in counts:
            counts[item["status"]] += 1
    manifest["summary"] = {
        "requested": len(manifest["assets"]),
        "ok": counts["ok"],
        "existing": counts["existing"],
        "dry_run": counts["dry-run"],
        "blocked": counts["blocked"],
        "failed": counts["failed"],
        "invalid": counts["invalid"],
        "failed_ids": [item["id"] for item in manifest["assets"] if item.get("status") in ("failed", "invalid", "blocked")],
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="generate all 30 icons and 12 buildings (the default)")
    parser.add_argument("--kind", choices=("icon", "building"), help="only generate one asset kind")
    parser.add_argument("--ids", nargs="+", help="only generate the listed ids, e.g. herb_01 clinic_lv1")
    parser.add_argument("--workers", type=int, default=2, help="parallel API requests (default: 2)")
    parser.add_argument("--dry-run", action="store_true", help="write a complete prompt manifest without calling the API")
    parser.add_argument("--check", action="store_true", help="validate formal files and refresh the manifest")
    parser.add_argument("--force", action="store_true", help="regenerate even when a formal file already exists")
    args = parser.parse_args(argv)
    if args.workers < 1:
        parser.error("--workers must be >= 1")

    tasks = _tasks(args.kind, args.ids)
    if not tasks:
        parser.error("no matching assets")
    manifest = _new_manifest(tasks)
    previous_by_id: Dict[str, Dict[str, Any]] = {}
    if args.check and MANIFEST_PATH.exists():
        try:
            previous = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            if previous.get("prompt_version") == PROMPT_VERSION:
                previous_by_id = {item["id"]: item for item in previous.get("assets", [])}
                for item in manifest["assets"]:
                    old = previous_by_id.get(item["id"])
                    if old:
                        item.update({key: old[key] for key in ("source_path", "formal_path", "prompt", "reference") if key in old})
        except (OSError, ValueError, TypeError):
            pass
    key = None if args.check else _read_api_key()
    if args.check:
        manifest["execution"].update({"status": "validation-only", "blocking_reason": None})
    elif args.dry_run:
        manifest["execution"].update({"status": "dry-run", "blocking_reason": None})
    elif key:
        manifest["execution"].update({"status": "generating", "api_key_available": True, "blocking_reason": None})
    else:
        manifest["execution"].update({
            "status": "blocked",
            "blocking_reason": "No API key found in VOLCENGINE_ARK_API_KEY, OPENAI_API_KEY, or ~/.codex/auth.json",
        })
    _json_dump(manifest)

    def record(index: int, task: Dict[str, Any], result: Dict[str, Any]) -> None:
        """Persist each completed item immediately for interruption recovery."""
        manifest["assets"][index - 1] = result
        _refresh_summary(manifest)
        _json_dump(manifest)
        print(f"[{index}/{len(tasks)}] {result['status'].upper()} {task['id']}")
        sys.stdout.flush()

    def checked_result(task: Dict[str, Any]) -> Dict[str, Any]:
        result = _entry_base(task)
        prior = previous_by_id.get(task["id"], {})
        # Preserve a recorded API block in the manifest while adding the
        # fresh file-validation details.  This keeps ``--check`` from
        # falsely turning an unavailable generation into a generic failure.
        if task["formal_path"].exists():
            result["status"] = "existing"
        elif prior.get("status") in ("blocked", "failed", "invalid"):
            result["status"] = prior["status"]
            result["error"] = prior.get("error")
        else:
            result["status"] = "failed"
        result["validation"] = _validate(task["formal_path"], task["kind"])
        if result["validation"]["ok"]:
            result["error"] = None
        elif not result.get("error"):
            result["error"] = "; ".join(result["validation"]["errors"])
        return result

    if args.check or args.workers == 1:
        completed = ((index, task, checked_result(task) if args.check else _process_one(task, key, args.dry_run, args.force))
                     for index, task in enumerate(tasks, 1))
        for index, task, result in completed:
            record(index, task, result)
    else:
        # API generation is the slow part; bounded concurrency keeps the batch
        # resumable while avoiding an unbounded burst against the gateway.
        max_workers = min(args.workers, len(tasks))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(_process_one, task, key, args.dry_run, args.force): (index, task)
                for index, task in enumerate(tasks, 1)
            }
            for future in as_completed(futures):
                index, task = futures[future]
                try:
                    result = future.result()
                except Exception as exc:  # defensive: _process_one already catches normal failures
                    result = _entry_base(task)
                    result["status"] = "failed"
                    result["error"] = f"{type(exc).__name__}: {exc}"
                record(index, task, result)

    _refresh_summary(manifest)
    _json_dump(manifest)
    summary = manifest["summary"]
    print("Summary: " + json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0 if not summary["failed_ids"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
