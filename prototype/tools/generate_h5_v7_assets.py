#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate and package the H5 v7 artwork batch.

The script is intentionally independent from the v6 generator.  It reuses
the tested chroma-key and WebP helpers from that generator, but uses the
frozen v7 Seedream model and writes only under ``assets/art/v7``.  Credentials
are read from a process environment variable or stdin and never enter the
manifest, prompt files, or stdout.

Examples (PowerShell):

    $env:VOLCENGINE_ARK_API_KEY = $env:ARK_API_KEY
    python prototype/tools/generate_h5_v7_assets.py --all --workers 3
    python prototype/tools/generate_h5_v7_assets.py --check
    python prototype/tools/generate_h5_v7_assets.py --dry-run
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os
from collections import deque
from pathlib import Path
import sys
import time
from io import BytesIO
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFont

# Reuse the v6 implementation's conservative alpha matte and WebP ladder.
from generate_h5_growth_assets import (  # type: ignore
    MAX_FORMAL_BYTES,
    _fit_to_canvas,
    _reference_data_uri,
    _save_webp,
    _sha256,
    _validate,
    remove_chroma,
)


MODEL = "doubao-seedream-5-0-260128"
ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations"
PROMPT_VERSION = "h5-v7-assets-2026-08-15"
MAX_BACKGROUND_BYTES = MAX_FORMAL_BYTES
ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / "prototype" / "assets" / "art" / "v7"
RAW = ART / "raw"
ICON_DIR = ART / "match3"
SECT_DIR = ART / "sect"
SCENE_DIR = ART / "scenes"
PRODUCER_DIR = ART / "producer_parts"
# Raw files remain grouped by production concern, while formal paths follow
# the frozen H5 integration contract (sect/match3/scenes).
BUILDING_DIR = SECT_DIR
PROP_DIR = SECT_DIR
BACKGROUND_DIR = SCENE_DIR
MANIFEST_PATH = ART / "asset_manifest.json"
DOC_MANIFEST_PATH = ROOT / "prototype" / "docs" / "h5_v7_asset_manifest.md"
CONTACT_PATH = ART / "contact_sheet.webp"

FAMILY_COLORS = {
    "build": (176, 116, 66),
    "herb": (74, 170, 96),
    "tool": (69, 132, 207),
    "groom": (150, 95, 191),
    "play": (218, 58, 135),
}
FAMILY_LABELS = {
    "build": "warm ochre construction material",
    "herb": "bright green medicinal herb",
    "tool": "clear blue apothecary tool",
    "groom": "lively purple grooming item",
    "play": "bright rose-magenta play toy",
}

ICON_REFS = {
    # There is no legacy build-material token in v6.  Use a simple tool token
    # as the style reference; the old clinic building reference caused
    # Seedream to hallucinate roofs in high-tier material icons.
    "build": ROOT / "prototype" / "assets" / "art" / "match3" / "tool_06.png",
    "herb": ROOT / "prototype" / "assets" / "art" / "match3" / "herb_06.png",
    "tool": ROOT / "prototype" / "assets" / "art" / "match3" / "tool_06.png",
    "groom": ROOT / "prototype" / "assets" / "art" / "match3" / "groom_06.png",
    "play": ROOT / "prototype" / "assets" / "art" / "match3" / "play_06.png",
}
BUILDING_REFS = {
    "gate": ROOT / "prototype" / "assets" / "art" / "buildings" / "clinic.webp",
    "clinic": ROOT / "prototype" / "assets" / "art" / "buildings" / "clinic.webp",
    "forecourt": ROOT / "prototype" / "assets" / "art" / "buildings" / "herb.webp",
    "groom_pavilion": ROOT / "prototype" / "assets" / "art" / "buildings" / "groom.webp",
}
BACKGROUND_REF = ROOT / "prototype" / "assets" / "art" / "scenes" / "bg_fox_lantern_buildingfree.webp"

ICON_LEVELS: Dict[str, List[str]] = {
    "build": [
        "one curved strand of fresh mountain vine with a few green leaves and a tiny bud, 山藤, single material item",
        "one short bundle of bright green bamboo poles tied with a simple cord, 青竹, single material item",
        "one polished warm-brown raw timber log with visible rings and one small branch, 原木, single material item",
        "three clean square-cut grey foundation stones stacked as one small group, 方石, single material item",
        "a neat small stack of blue-green fired masonry bricks with crisp edges, 青砖, single material item",
        "one ornate blue-grey roof-tile end ornament with a carved circular face, 瓦当, single material item",
        "one small ceramic jar of amber camphor oil with a wooden cap and lacquer brush, 桐油, single material item",
        "one long premium golden-thread nanmu plank with fine gold grain and carved ends, 金丝楠, single material item",
        "a small tied bundle of glossy teal glazed roof tiles with luminous highlights, 琉璃瓦, single material item",
        "one imposing but standalone master construction beam with carved cloud ends and a jade joinery mark, 天工梁, single material item",
    ],
    "herb": [
        "one bright green calming herb sprig with rounded leaves and a tiny dew drop, 清心草, single herb",
        "one segmented jade-green magical ginseng root with nine clear joints and fine roots, 九节灵参, single herb",
        "one luminous moonlit reishi mushroom with a pale silver cap and a small green stem, 月华灵芝, single herb",
        "one glowing immortal-tree sprout with a jade stem, two fresh leaves and a warm golden bud, 不死树芽, single herb",
    ],
    "tool": [
        "one polished celadon-blue jade medicine jar with a rounded lid and a small cloud seal, 青玉药罐, single tool",
        "one bright blue-green herb pestle with carved botanical grooves and a rounded bowl end, 百草杵, single tool",
        "one compact blue medicine case with a cloud pattern, brass clasp and two tiny bottle slots, 云纹药箱, single tool",
        "one majestic but standalone blue-and-bronze medicine cauldron with three legs, cloud handles and a glowing rim, 药王鼎, single tool",
    ],
    "groom": [
        "one flowing purple cloud-silk cloak with a soft scalloped edge, tiny jade clasp and embroidered cloud trim, 云缎披风, single grooming item",
        "one ornate round purple treasure mirror with nine small fox-tail motifs around its rim and a jade handle, 九尾宝镜, single grooming item",
    ],
    "play": [
        "one small warm-wood rocking horse toy with a bright bell on its neck, rounded feet and a rose-magenta ribbon, 木马摇铃, single toy",
        "one compact rose-magenta tabletop hundred-plays toy stage with tiny curtains, a drum and two pennants, 百戏台, single toy; it must remain a small toy prop, not a building",
    ],
}

PRODUCER_PARTS: Dict[str, List[str]] = {
    "herb": [
        "a small warm-brown ball of magical planting soil with a single green sprout",
        "one folded green bamboo basket panel with a bright jade binding cord",
        "a compact jade-green dew collecting seedbed with rounded planting cups",
        "a neat miniature herb nursery with rows of luminous green seedlings, bamboo edging and a tiny water channel",
        "a clearly functional five-tier magical herb nursery generator, an ornate jade-and-bamboo growing rack with glowing herb beds, dew collector, water wheel and a small warm status lantern",
    ],
    "tool": [
        "a few bright copper gear fragments and one tiny blue screw",
        "a compact blue-bronze medicine furnace mechanism with one gear and a short pipe",
        "a polished blue inner furnace core with concentric copper rings and a soft glow",
        "a refined blue apothecary machine with bellows, copper gears, a small heat gauge and a medicine tray",
        "a clearly functional five-tier magical medicine-tool generator, an ornate blue-bronze alchemy furnace with moving gears, bellows, glowing core, output tray and a small warm status lantern",
    ],
    "build": [
        "a small pile of warm cedar joinery shavings with one carved wooden peg",
        "two polished warm-brown mortise-and-tenon carpenter components tied with cord",
        "a compact handheld spirit-wood mechanical casing, palm-sized carved wooden box with exposed brass gears, hinge and jade core, 灵木机匣; absolutely no roof, wall, house, pavilion or architecture",
        "a small tabletop woodworking workbench object with two clamps, loose beams, carved brackets and a tiny lantern, 山门工台; no roof, wall, house, pavilion, tower or architecture",
        "a compact tabletop cloud-gate maker generator machine on one stone base, with a rotating crane arm, joinery clamps, output tray and warm status lantern, 云阙造物台; a clickable production machine but not a tower, house, pavilion, gate or architecture",
    ],
}

BUILDING_LEVELS: Dict[str, List[str]] = {
    "gate": [
        "a small weathered timber sect gate, chipped blue-grey roof tiles, one leaning post, torn vine and a crooked blank wooden plaque",
        "the same sect gate and locked camera, roof tiles repaired, posts straightened, two polished door rings and a clean blank plaque",
        "the same gate and locked camera, freshly repaired roof trim, symmetrical timber posts, two warm lanterns, a blank polished plaque and neat stone steps",
        "the same gate and locked camera, grand but compact renewed mountain gate, layered roof ridges, carved beams, glowing lanterns, tidy stone base and a blank plaque",
    ],
    "clinic": [
        "a small abandoned medicine hall, faded warm timber, cracked blue-grey roof, broken porch rail, sparse herb bundles and one dim lantern",
        "the same medicine hall and locked camera, roof repaired, porch rail restored, shelves cleaned, two hanging herb bundles and one warm lantern",
        "the same medicine hall and locked camera, polished roof trim, open consultation window, full medicine shelves, covered porch, two lanterns and a tidy herb planter",
        "the same medicine hall and locked camera, handsome renewed healing clinic, layered roof, apothecary cabinet, covered porch, three warm lanterns, medicine garden and stone steps",
    ],
    "forecourt": [
        "a broad neglected stone welcome forecourt, fallen leaves covering the path, one overturned low bench, broken edging stones and wild weeds",
        "the same forecourt and locked camera, central stone path swept clear, bench upright, edging stones repaired and weeds trimmed into small patches",
        "the same forecourt and locked camera, neat stone path, two low benches, flower beds, repaired lantern posts and a small guest rest area",
        "the same forecourt and locked camera, welcoming polished courtyard plaza, patterned stone path, flower beds, glowing lantern posts, tidy benches and a clear central arrival space",
    ],
    "groom_pavilion": [
        "a small weathered open grooming pavilion, faded timber, patched teal roof, torn curtain, one empty bench and a crooked comb basket",
        "the same grooming pavilion and locked camera, roof patched, curtain repaired, bench straightened, comb basket filled and one soft lantern",
        "the same grooming pavilion and locked camera, polished roof trim, clean curtains, mirror stand, folded towels, grooming bench and two lanterns",
        "the same grooming pavilion and locked camera, graceful renewed grooming pavilion, layered roof, decorated deck, mirror stand, towel shelves, bamboo planter and three warm lanterns",
    ],
}

COMMON_ICON_PROMPT = (
    "Use case: game-match3-icon. Asset type: transparent 2D board token. "
    "Create one centered standalone object, fully inside a square frame with generous padding. "
    "Match the supplied existing H5 reference: cute hand-painted Chinese Shanhai Jing healing game, watercolor and gouache, "
    "soft rounded chibi silhouette, crisp warm-brown ink outline, readable at 42px, subtle paper grain. "
    "The family color must dominate the object ({family_label}); make this high tier visibly richer than lower tiers using silhouette, material and one or two functional details. "
    "Draw only the named single item or small item group; never turn it into a building, house, roof, pavilion, gate, room, landscape or scene. No cast shadow, no floor, no reflection, no character, no animal, no text, no letters, no numbers, no watermark, no logo. "
    "Place the object on a perfectly flat solid #ff00ff chroma-key background with no gradient, texture or lighting variation. Do not use #ff00ff in the object."
)
COMMON_BUILDING_PROMPT = (
    "Use case: game-building-sprite. Asset type: transparent 2D H5 courtyard renovation sprite. "
    "Match the supplied existing building reference in style: cute Chinese Shanhai Jing healing courtyard, hand-painted watercolor and gouache, warm timber, rounded forms, warm brown ink outline, soft paper texture, slightly elevated three-quarter view, upper-left key light, readable at 100px. "
    "Lock camera, perspective, footprint, bottom base anchor at 92% canvas height and center x at 50% for every stage. "
    "Keep the area identity and stage-to-stage silhouette stable; change only repair quality, scale within the same footprint, roof trim, functional props and small decorations. "
    "No people, no animals, no text, no letters, no numbers, no logo, no UI, no cast shadow outside the object. "
    "Place the object on a perfectly flat solid #ff00ff chroma-key background with no gradient or texture. Do not use #ff00ff in the object."
)
COMMON_FORECOURT_PROMPT = (
    "Use case: game-ground-prop. Asset type: transparent 2D H5 courtyard ground prop. "
    "Match the supplied empty courtyard reference in warm watercolor and gouache style, with readable stone, wood and plant details and an elevated three-quarter view. "
    "This is a ground-level welcome forecourt composition, not a building: lock the camera, footprint and base anchor at 92% canvas height and center x at 50% for every stage. "
    "Keep the central path and low props broad and readable; never add a roof, wall, house, pavilion, gate, hut, room, signboard or tall structure. "
    "No people, no animals, no text, no letters, no numbers, no logo, no UI, no cast shadow outside the object. "
    "Place the object on a perfectly flat solid #ff00ff chroma-key background with no gradient or texture. Do not use #ff00ff in the object."
)
COMMON_BACKGROUND_PROMPT = (
    "Use case: illustration-story. Asset type: vertical 2D mobile game courtyard background. "
    "Create an empty building-free Chinese Shanhai Jing healing courtyard in the same warm watercolor and gouache style as the supplied reference building sprites. "
    "4:5 portrait composition, elevated perspective, a broad central stone path, distant blue mountains, bamboo, flowering trees, pond and four clearly empty stone-and-timber foundation zones: two near the upper sides and two near the lower sides. "
    "Keep the center path and four foundation zones readable for composited buildings. No house, roof, pavilion, hut, gate, stall, furniture, characters, animals, text, logo or UI."
)


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_key() -> Optional[str]:
    # Explicit stdin is useful for a one-shot local process and avoids shell
    # history. Environment lookup is still the normal route.
    for name in ("VOLCENGINE_ARK_API_KEY", "ARK_API_KEY", "OPENAI_API_KEY"):
        value = os.environ.get(name)
        if value and value.strip():
            return value.strip()
    if not sys.stdin.isatty():
        try:
            value = sys.stdin.read().strip()
            return value or None
        except OSError:
            return None
    return None


def request_image(prompt: str, reference: Optional[Path], key: str, *, size: str = "2048x2048", timeout: int = 300) -> Image.Image:
    body: Dict[str, Any] = {
        "model": MODEL,
        "prompt": prompt,
        "size": size,
        "n": 1,
        "response_format": "url",
        "output_format": "png",
        "watermark": False,
    }
    if reference:
        uri = _reference_data_uri(reference)
        if uri:
            body["image"] = uri
    response = requests.post(
        ENDPOINT,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=body,
        timeout=timeout,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Seedream HTTP {response.status_code}")
    try:
        payload = response.json()
        item = payload["data"][0]
        url = item.get("url") if isinstance(item, dict) else None
        encoded = item.get("b64_json") if isinstance(item, dict) else None
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Seedream response missing image data") from exc
    if url:
        image_response = requests.get(url, timeout=timeout)
        image_response.raise_for_status()
        return Image.open(BytesIO(image_response.content)).convert("RGBA")
    if encoded:
        return Image.open(BytesIO(base64.b64decode(encoded))).convert("RGBA")
    raise RuntimeError("Seedream response contained neither url nor b64_json")


def save_background(image: Image.Image, path: Path) -> Tuple[int, int]:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = image.convert("RGB")
    # Seedream square output is center-cropped to the requested 4:5 release
    # ratio, keeping the focal path and foundation zones in frame.
    target_ratio = 4 / 5
    current_ratio = image.width / image.height
    if current_ratio > target_ratio:
        width = round(image.height * target_ratio)
        left = max(0, (image.width - width) // 2)
        image = image.crop((left, 0, left + width, image.height))
    elif current_ratio < target_ratio:
        height = round(image.width / target_ratio)
        top = max(0, (image.height - height) // 2)
        image = image.crop((0, top, image.width, top + height))
    image = image.resize((800, 1000), Image.Resampling.LANCZOS)
    quality = 88
    while True:
        buf = BytesIO()
        image.save(buf, "WEBP", quality=quality, method=6)
        if len(buf.getvalue()) <= MAX_BACKGROUND_BYTES or quality <= 30:
            path.write_bytes(buf.getvalue())
            return len(buf.getvalue()), quality
        quality -= 6


def validate_background(path: Path) -> Dict[str, Any]:
    result: Dict[str, Any] = {"ok": False, "errors": []}
    if not path.exists():
        result["errors"].append("missing formal file")
        return result
    try:
        image = Image.open(path).convert("RGB")
    except (OSError, ValueError) as exc:
        result["errors"].append(f"unreadable image: {type(exc).__name__}")
        return result
    result.update({"dimensions": [image.width, image.height], "file_bytes": path.stat().st_size})
    if image.size != (800, 1000):
        result["errors"].append("background dimensions must be 800x1000")
    if path.stat().st_size > MAX_BACKGROUND_BYTES:
        result["errors"].append("background exceeds 1 MiB")
    result["ok"] = not result["errors"]
    return result


def make_icon_badge(image: Image.Image, family: str, level: int) -> Image.Image:
    image = image.copy().convert("RGBA")
    draw = ImageDraw.Draw(image)
    accent = FAMILY_COLORS[family]
    cx, cy, radius = image.width - 28, 28, 18
    draw.ellipse((cx - radius - 2, cy - radius - 2, cx + radius + 2, cy + radius + 2), fill=(112, 76, 54, 245))
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*accent, 255))
    pip_r = 2.4
    for index in range(level):
        angle = -1.5708 + index * 6.2832 / max(1, level)
        px = cx + np.cos(angle) * 10
        py = cy + np.sin(angle) * 10
        draw.ellipse((px - pip_r, py - pip_r, px + pip_r, py + pip_r), fill=(255, 246, 218, 255))
    return image


def remove_generated_background(image: Image.Image) -> Image.Image:
    """Remove Seedream's *actual* flat border color, not just #ff00ff.

    Seedream sometimes shifts a requested chroma key toward a magenta hue
    (for example RGB 194/37/127).  The v6 helper intentionally only keys the
    exact requested color, so v7 samples the outer border and flood-fills only
    connected pixels near that sampled color.  This preserves similarly
    colored details inside the object and keeps antialiased edges soft.
    """
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba).copy()
    rgb = arr[:, :, :3]
    h, w = rgb.shape[:2]
    border_width = max(2, min(12, round(min(h, w) * 0.01)))
    samples = np.concatenate(
        [rgb[:border_width, :, :].reshape(-1, 3), rgb[-border_width:, :, :].reshape(-1, 3),
         rgb[:, :border_width, :].reshape(-1, 3), rgb[:, -border_width:, :].reshape(-1, 3)]
    ).astype(np.float32)
    key = np.median(samples, axis=0)
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - key) ** 2, axis=2))
    # A modest threshold removes mild generation gradients while retaining
    # colored outlines.  If the border is noisy, increase it only slightly.
    border_distance = np.sqrt(np.sum((samples - key) ** 2, axis=1))
    threshold = float(max(52.0, min(105.0, np.percentile(border_distance, 95) + 42.0)))
    candidates = distance <= threshold
    seen = np.zeros((h, w), dtype=bool)
    queue: deque[Tuple[int, int]] = deque()
    for x in range(w):
        if candidates[0, x]: seen[0, x] = True; queue.append((0, x))
        if candidates[h - 1, x] and not seen[h - 1, x]: seen[h - 1, x] = True; queue.append((h - 1, x))
    for y in range(h):
        if candidates[y, 0] and not seen[y, 0]: seen[y, 0] = True; queue.append((y, 0))
        if candidates[y, w - 1] and not seen[y, w - 1]: seen[y, w - 1] = True; queue.append((y, w - 1))
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and candidates[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    alpha = np.full((h, w), 255, dtype=np.uint8)
    alpha[seen] = 0
    edge = np.zeros_like(seen)
    edge[:-1, :] |= seen[1:, :]
    edge[1:, :] |= seen[:-1, :]
    edge[:, :-1] |= seen[:, 1:]
    edge[:, 1:] |= seen[:, :-1]
    soft = edge & ~seen
    alpha_soft = np.clip((distance[soft] - threshold * 0.25) / (threshold * 0.75) * 255.0, 0, 255).astype(np.uint8)
    alpha[soft] = alpha_soft
    # Remove faint one-pixel generation noise and despill the sampled magenta
    # from antialiased edges. Opaque subject colors remain untouched; for
    # translucent pixels cap the key-dominant channels at the strongest
    # non-key channel, matching the installed helper's spill cleanup rule.
    alpha[alpha < 20] = 0
    semi = (alpha >= 20) & (alpha < 245)
    if semi.any():
        pixels = rgb[semi].astype(np.int16)
        key_max = float(np.max(key))
        spill_channels = [index for index, value in enumerate(key) if value >= key_max - 16 and value >= 128]
        non_spill = [index for index in range(3) if index not in spill_channels]
        if spill_channels and non_spill:
            anchor = np.max(pixels[:, non_spill], axis=1)
            cap = np.maximum(0, anchor - 1)
            for channel in spill_channels:
                pixels[:, channel] = np.minimum(pixels[:, channel], cap)
            rgb[semi] = np.clip(pixels, 0, 255).astype(np.uint8)
    # A few Seedream responses place a pale rectangular matte behind a soft
    # object.  It is not part of the subject when it is translucent; remove
    # only low-coverage near-white pixels so opaque white highlights survive.
    near_white = (rgb.min(axis=2) >= 235) & (alpha < 220)
    alpha[near_white] = 0
    arr[:, :, 3] = alpha
    arr[alpha == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def remove_building_background(image: Image.Image) -> Image.Image:
    """Remove both border and enclosed chroma holes from building sprites."""
    cleaned = remove_generated_background(image)
    arr = np.asarray(cleaned).copy()
    original = np.asarray(image.convert("RGBA"))
    rgb = original[:, :, :3]
    h, w = rgb.shape[:2]
    band = max(2, min(12, round(min(h, w) * 0.01)))
    samples = np.concatenate([rgb[:band].reshape(-1, 3), rgb[-band:].reshape(-1, 3), rgb[:, :band].reshape(-1, 3), rgb[:, -band:].reshape(-1, 3)]).astype(np.float32)
    key = np.median(samples, axis=0)
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - key) ** 2, axis=2))
    border_distance = np.sqrt(np.sum((samples - key) ** 2, axis=1))
    threshold = float(max(42.0, min(96.0, np.percentile(border_distance, 95) + 34.0)))
    enclosed = distance <= threshold
    arr[:, :, 3][enclosed] = 0
    arr[enclosed, :3] = 0
    return Image.fromarray(arr, "RGBA")


def clean_resampled_edge(image: Image.Image) -> Image.Image:
    """Remove low-alpha matte pixels introduced by resize/premultiplication."""
    arr = np.asarray(image.convert("RGBA")).copy()
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    near_white = rgb.min(axis=2) >= 220
    near_black = rgb.max(axis=2) <= 18
    near_magenta = (rgb[:, :, 0] > 100) & (rgb[:, :, 2] > 80) & (rgb[:, :, 1] < 105)
    red_spill = (rgb[:, :, 0].astype(np.int16) - rgb[:, :, 1].astype(np.int16) > 55) & (rgb[:, :, 2].astype(np.int16) - rgb[:, :, 1].astype(np.int16) > 25)
    # Erode pale/black matte pixels from the outside inward. This removes the
    # opaque white halo that can be fused to a purple cloak in the source;
    # interior white decorations are retained once they are no longer next to
    # transparency.
    for _ in range(5):
        transparent = alpha == 0
        adjacent = np.zeros_like(transparent)
        adjacent[:-1, :] |= transparent[1:, :]
        adjacent[1:, :] |= transparent[:-1, :]
        adjacent[:, :-1] |= transparent[:, 1:]
        adjacent[:, 1:] |= transparent[:, :-1]
        spill_edge = adjacent & (near_magenta | red_spill)
        if spill_edge.any():
            pixels = rgb[spill_edge].astype(np.int16)
            green = pixels[:, 1]
            # Keep the edge hue from collapsing to a dark outline, but cap
            # the key-dominant red/blue channels so magenta cannot survive.
            pixels[:, 0] = np.minimum(pixels[:, 0], green + 18)
            pixels[:, 2] = np.minimum(pixels[:, 2], green + 18)
            rgb[spill_edge] = np.clip(pixels, 0, 255).astype(np.uint8)
        remove = adjacent & (near_white | (near_magenta & (alpha < 120)) | (red_spill & (alpha < 96)) | (near_black & (alpha < 180)))
        if not remove.any():
            break
        alpha[remove] = 0
    # Remove faint isolated specks while preserving the primary silhouette.
    # The badge is added after this pass, so it is never accidentally pruned.
    mask = alpha > 16
    visited = np.zeros_like(mask)
    min_component = 24 if image.width <= 256 else 80
    for sy, sx in zip(*np.where(mask & ~visited)):
        if visited[sy, sx]:
            continue
        stack = [(int(sy), int(sx))]
        visited[sy, sx] = True
        component: List[Tuple[int, int]] = []
        while stack:
            y, x = stack.pop()
            component.append((y, x))
            for ny in range(y - 1, y + 2):
                for nx in range(x - 1, x + 2):
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
        if len(component) < min_component:
            ys = [point[0] for point in component]
            xs = [point[1] for point in component]
            alpha[ys, xs] = 0
    arr[:, :, 3] = alpha
    arr[alpha == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def icon_tasks() -> Iterable[Dict[str, Any]]:
    for family, descriptions in ICON_LEVELS.items():
        start = 1 if family == "build" else (7 if family in ("herb", "tool") else 7)
        for offset, subject in enumerate(descriptions):
            level = start + offset
            stem = f"{family}_{level:02d}"
            formal = ICON_DIR / f"{stem}.webp"
            yield {
                "id": stem,
                "kind": "icon",
                "family": family,
                "level": level,
                "prompt": COMMON_ICON_PROMPT.format(family_label=FAMILY_LABELS[family]) + f" Subject: {subject}. This is tier {level}; keep it clearly distinct from adjacent tiers.",
                "reference_path": ICON_REFS[family],
                "source_path": RAW / "icons" / f"{stem}.png",
                "formal_path": formal,
            }


def producer_tasks() -> Iterable[Dict[str, Any]]:
    """Five-step, facility-facing generator parts for each active family."""
    for family, descriptions in PRODUCER_PARTS.items():
        for level, subject in enumerate(descriptions, 1):
            stem = f"{family}_part_{level:02d}"
            yield {
                "id": stem,
                "kind": "producer_part",
                "family": family,
                "level": level,
                "prompt": COMMON_ICON_PROMPT.format(family_label=FAMILY_LABELS[family]) + f" Subject: {subject}. This is producer-part stage {level} of 5; keep the silhouette distinct from adjacent stages and keep the object centered.",
                "reference_path": ICON_REFS[family],
                "source_path": RAW / "producer_parts" / f"{stem}.png",
                "formal_path": PRODUCER_DIR / f"{stem}.webp",
            }


def building_tasks() -> Iterable[Dict[str, Any]]:
    for area, descriptions in BUILDING_LEVELS.items():
        for index, subject in enumerate(descriptions, 1):
            # Forecourt is a ground prop, but keeping it in a separate props
            # folder makes the composition semantics explicit to the integrator.
            root = PROP_DIR if area == "forecourt" else BUILDING_DIR
            stem = f"{area}_stage{index - 1}"
            base_prompt = COMMON_FORECOURT_PROMPT if area == "forecourt" else COMMON_BUILDING_PROMPT
            yield {
                "id": stem,
                "kind": "building",
                "area": area,
                "level": index,
                "prompt": base_prompt + f" Subject: {subject}. This is renovation stage {index} of 4; do not add any words or sign text.",
                "reference_path": BUILDING_REFS[area],
                "source_path": RAW / ("props" if area == "forecourt" else "buildings") / f"{area}_stage{index - 1}.png",
                "formal_path": root / f"{stem}.webp",
            }


def background_task() -> Dict[str, Any]:
    return {
        "id": "bg_fox_lantern_buildingfree",
        "kind": "background",
        "family": "scene",
        "level": 1,
        "prompt": COMMON_BACKGROUND_PROMPT + " Use the supplied fox-lantern courtyard only as a color and atmosphere reference; remove all buildings and fox-shaped lantern props.",
        "reference_path": BACKGROUND_REF,
        "source_path": RAW / "backgrounds" / "bg_fox_lantern_buildingfree.png",
        "formal_path": BACKGROUND_DIR / "bg_fox_lantern_buildingfree.webp",
    }


def all_tasks() -> List[Dict[str, Any]]:
    return list(building_tasks()) + list(icon_tasks()) + list(producer_tasks()) + [background_task()]


def entry_base(task: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": task["id"],
        "kind": task["kind"],
        "family": task.get("family", task.get("area", "scene")),
        "area": task.get("area"),
        "level": task.get("level"),
        "prompt": task["prompt"],
        "reference": rel(task["reference_path"]),
        "source_path": rel(task["source_path"]),
        "formal_path": rel(task["formal_path"]),
        "status": "pending",
        "source_sha256": _sha256(task["source_path"]),
        "formal_sha256": _sha256(task["formal_path"]),
        "source_bytes": task["source_path"].stat().st_size if task["source_path"].exists() else None,
        "formal_bytes": task["formal_path"].stat().st_size if task["formal_path"].exists() else None,
        "validation": None,
        "error": None,
    }


def process_icon(task: Dict[str, Any], key: Optional[str], *, dry_run: bool, force: bool) -> Dict[str, Any]:
    entry = entry_base(task)
    if not force and task["formal_path"].exists():
        entry["status"] = "existing"
        entry["validation"] = _validate(task["formal_path"], "icon")
        return entry
    if dry_run:
        entry["status"] = "dry-run"
        return entry
    if not key:
        entry.update({"status": "blocked", "error": "missing API key"})
        return entry
    last_error = None
    for attempt in range(3):
        try:
            generated = request_image(task["prompt"], task["reference_path"], key)
            task["source_path"].parent.mkdir(parents=True, exist_ok=True)
            generated.save(task["source_path"], "PNG", optimize=True)
            cleaner = remove_building_background if task["kind"] == "producer_part" or task["family"] == "build" else remove_generated_background
            cutout = clean_resampled_edge(_fit_to_canvas(cleaner(generated), (256, 256), "icon"))
            cutout = clean_resampled_edge(make_icon_badge(cutout, task["family"], int(task["level"])))
            size, quality = _save_webp(cutout, task["formal_path"])
            validation = _validate(task["formal_path"], "icon")
            entry.update({"status": "ok" if validation["ok"] else "invalid", "source_sha256": _sha256(task["source_path"]), "formal_sha256": _sha256(task["formal_path"]), "source_bytes": task["source_path"].stat().st_size, "formal_bytes": size, "webp_quality": quality, "validation": validation})
            if not validation["ok"]:
                entry["error"] = "; ".join(validation["errors"])
            return entry
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < 2:
                time.sleep(2 ** attempt)
    entry.update({"status": "failed", "error": last_error or "unknown generation error"})
    return entry


def process_background(task: Dict[str, Any], key: Optional[str], *, dry_run: bool, force: bool) -> Dict[str, Any]:
    entry = entry_base(task)
    if not force and task["formal_path"].exists():
        entry["status"] = "existing"
        entry["validation"] = validate_background(task["formal_path"])
        return entry
    if dry_run:
        entry["status"] = "dry-run"
        return entry
    if not key:
        entry.update({"status": "blocked", "error": "missing API key"})
        return entry
    try:
        generated = request_image(task["prompt"], task["reference_path"], key)
        task["source_path"].parent.mkdir(parents=True, exist_ok=True)
        generated.convert("RGB").save(task["source_path"], "PNG", optimize=True)
        size, quality = save_background(generated, task["formal_path"])
        validation = validate_background(task["formal_path"])
        entry.update({"status": "ok" if validation["ok"] else "invalid", "source_sha256": _sha256(task["source_path"]), "formal_sha256": _sha256(task["formal_path"]), "source_bytes": task["source_path"].stat().st_size, "formal_bytes": size, "webp_quality": quality, "validation": validation})
        if not validation["ok"]:
            entry["error"] = "; ".join(validation["errors"])
    except Exception as exc:
        entry.update({"status": "failed", "error": f"{type(exc).__name__}: {exc}"})
    return entry


def process_building_area(area: str, tasks: List[Dict[str, Any]], key: Optional[str], *, dry_run: bool, force: bool) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    previous: Optional[Path] = None
    for task in sorted(tasks, key=lambda item: int(item["level"])):
        task = dict(task)
        if previous and previous.exists():
            task["reference_path"] = previous
            task["prompt"] += " Use the previous renovation stage image as the primary continuity reference; preserve its camera, footprint, anchor and silhouette."
        result = entry_base(task)
        if not force and task["formal_path"].exists():
            result["status"] = "existing"
            result["validation"] = _validate(task["formal_path"], "building")
            results.append(result)
            previous = task["formal_path"]
            continue
        if dry_run:
            result["status"] = "dry-run"
            results.append(result)
            previous = task["formal_path"]
            continue
        if not key:
            result.update({"status": "blocked", "error": "missing API key"})
            results.append(result)
            continue
        last_error = None
        for attempt in range(3):
            try:
                generated = request_image(task["prompt"], task["reference_path"], key)
                task["source_path"].parent.mkdir(parents=True, exist_ok=True)
                generated.save(task["source_path"], "PNG", optimize=True)
                cutout = clean_resampled_edge(_fit_to_canvas(remove_building_background(generated), (768, 768), "building"))
                size, quality = _save_webp(cutout, task["formal_path"])
                validation = _validate(task["formal_path"], "building")
                result.update({"status": "ok" if validation["ok"] else "invalid", "source_sha256": _sha256(task["source_path"]), "formal_sha256": _sha256(task["formal_path"]), "source_bytes": task["source_path"].stat().st_size, "formal_bytes": size, "webp_quality": quality, "validation": validation, "reference": rel(task["reference_path"])})
                if not validation["ok"]:
                    result["error"] = "; ".join(validation["errors"])
                break
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < 2:
                    time.sleep(2 ** attempt)
        else:
            result.update({"status": "failed", "error": last_error or "unknown generation error"})
        results.append(result)
        if task["formal_path"].exists():
            previous = task["formal_path"]
    return results


def new_manifest(tasks: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "schema": "h5-v7-assets",
        "prompt_version": PROMPT_VERSION,
        "model": MODEL,
        "endpoint": ENDPOINT,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "constraints": {
            "requested_assets": 54,
            "building_stage_count": 16,
            "icon_count": 22,
            "producer_part_count": 15,
            "background_count": 1,
            "formal_max_bytes": MAX_FORMAL_BYTES,
            "icon_dimensions": [256, 256],
            "building_dimensions": [768, 768],
            "background_dimensions": [800, 1000],
            "transparent_background": "#ff00ff chroma-key removed locally",
            "building_anchor": {"camera": "locked", "center_x": 0.5, "base_y": 0.92},
        },
        "references": {"buildings": {name: rel(path) for name, path in BUILDING_REFS.items()}, "background": rel(BACKGROUND_REF), "icons": {name: rel(path) for name, path in ICON_REFS.items()}},
        "execution": {"status": "pending", "api_key_available": False, "blocking_reason": None},
        "assets": [entry_base(task) for task in tasks],
        "contact_sheet": rel(CONTACT_PATH),
        "summary": {},
    }


def refresh_summary(manifest: Dict[str, Any]) -> None:
    statuses = {"ok": 0, "existing": 0, "dry-run": 0, "blocked": 0, "failed": 0, "invalid": 0, "pending": 0}
    for item in manifest.get("assets", []):
        statuses[item.get("status", "pending")] = statuses.get(item.get("status", "pending"), 0) + 1
    manifest["summary"] = {"requested": len(manifest.get("assets", [])), **{k.replace("-", "_"): v for k, v in statuses.items()}, "failed_ids": [item["id"] for item in manifest.get("assets", []) if item.get("status") in ("failed", "invalid", "blocked")]}


def dump_manifest(manifest: Dict[str, Any]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MANIFEST_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(MANIFEST_PATH)


def make_contact_sheet(manifest: Dict[str, Any]) -> None:
    cards: List[Tuple[str, Path]] = []
    for item in manifest.get("assets", []):
        path = ROOT / item["formal_path"]
        if path.exists():
            cards.append((item["id"], path))
    if not cards:
        return
    thumb_w, thumb_h = 180, 180
    label_h = 24
    cols = 6
    rows = (len(cards) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), (247, 239, 220))
    draw = ImageDraw.Draw(sheet)
    for index, (label, path) in enumerate(cards):
        x = (index % cols) * thumb_w
        y = (index // cols) * (thumb_h + label_h)
        try:
            image = Image.open(path).convert("RGBA")
            checker = Image.new("RGBA", image.size, (255, 250, 235, 255))
            checker.alpha_composite(image)
            image = checker.convert("RGB")
            image.thumbnail((thumb_w - 12, thumb_h - 12), Image.Resampling.LANCZOS)
            sheet.paste(image, (x + (thumb_w - image.width) // 2, y + (thumb_h - image.height) // 2))
        except (OSError, ValueError):
            pass
        draw.text((x + 5, y + thumb_h + 3), label[:25], fill=(80, 60, 45))
    CONTACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_PATH, "WEBP", quality=82, method=6)


def write_doc_manifest(manifest: Dict[str, Any]) -> None:
    DOC_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# H5 v7 素材清单",
        "",
        f"- 模型：`{manifest['model']}`",
        f"- 提示词版本：`{manifest['prompt_version']}`",
        "- 资源根目录：`prototype/assets/art/v7/`",
        "- API 密钥未写入本清单。",
        "",
        "| ID | 类型 | 正式资源 | 状态 | 尺寸 | 大小 | SHA256 |",
        "|---|---|---|---|---:|---:|---|",
    ]
    for item in manifest.get("assets", []):
        validation = item.get("validation") or {}
        dims = "×".join(str(value) for value in validation.get("dimensions", [])) if validation.get("dimensions") else "-"
        size = item.get("formal_bytes") or "-"
        sha = item.get("formal_sha256") or "-"
        lines.append(f"| `{item['id']}` | {item['kind']} | `{item['formal_path']}` | {item.get('status','pending')} | {dims} | {size} | `{sha}` |")
    lines += ["", f"接触表：`{rel(CONTACT_PATH)}`", ""]
    DOC_MANIFEST_PATH.write_text("\n".join(lines), encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="generate all v7 assets (default)")
    parser.add_argument("--kind", choices=("icon", "producer_part", "building", "background"), help="limit generation")
    parser.add_argument("--ids", nargs="+", help="limit to exact IDs")
    parser.add_argument("--workers", type=int, default=3, help="parallel icon/area pipelines")
    parser.add_argument("--dry-run", action="store_true", help="write prompts without API calls")
    parser.add_argument("--check", action="store_true", help="validate formal files only")
    parser.add_argument("--force", action="store_true", help="regenerate existing formal files")
    args = parser.parse_args(argv)
    if args.workers < 1:
        parser.error("--workers must be >= 1")
    tasks = all_tasks()
    if args.kind:
        tasks = [task for task in tasks if task["kind"] == args.kind]
    if args.ids:
        selected = set(args.ids)
        tasks = [task for task in tasks if task["id"] in selected]
    if not tasks:
        parser.error("no matching assets")

    manifest = new_manifest(tasks)
    key = None if args.check or args.dry_run else read_key()
    if args.check:
        manifest["execution"].update({"status": "validation-only"})
    elif args.dry_run:
        manifest["execution"].update({"status": "dry-run"})
    elif key:
        manifest["execution"].update({"status": "generating", "api_key_available": True})
    else:
        manifest["execution"].update({"status": "blocked", "blocking_reason": "No API key supplied through process env or stdin"})
    dump_manifest(manifest)

    if args.check:
        results = []
        for task in tasks:
            result = entry_base(task)
            if task["kind"] == "background":
                result["validation"] = validate_background(task["formal_path"])
            else:
                result["validation"] = _validate(task["formal_path"], "icon" if task["kind"] in ("icon", "producer_part") else task["kind"])
            result["status"] = "existing" if result["validation"]["ok"] else "invalid"
            result["error"] = None if result["validation"]["ok"] else "; ".join(result["validation"]["errors"])
            results.append(result)
    elif args.dry_run:
        results = [dict(entry_base(task), status="dry-run") for task in tasks]
    else:
        results = []
        # Build stages must run in order per area so each stage can reference
        # the previous image.  Areas and icons are safely parallelized.
        building_groups: Dict[str, List[Dict[str, Any]]] = {}
        icon_list: List[Dict[str, Any]] = []
        background_list: List[Dict[str, Any]] = []
        for task in tasks:
            if task["kind"] == "building":
                building_groups.setdefault(task["area"], []).append(task)
            elif task["kind"] in ("icon", "producer_part"):
                icon_list.append(task)
            else:
                background_list.append(task)
        with ThreadPoolExecutor(max_workers=min(args.workers, max(1, len(building_groups) + 2))) as pool:
            futures = []
            for area, group in building_groups.items():
                futures.append(pool.submit(process_building_area, area, group, key, dry_run=False, force=args.force))
            for task in icon_list:
                futures.append(pool.submit(process_icon, task, key, dry_run=False, force=args.force))
            for task in background_list:
                futures.append(pool.submit(process_background, task, key, dry_run=False, force=args.force))
            for future in as_completed(futures):
                value = future.result()
                if isinstance(value, list):
                    results.extend(value)
                else:
                    results.append(value)
    by_id = {item["id"]: item for item in results}
    manifest["assets"] = [by_id.get(task["id"], entry_base(task)) for task in tasks]
    refresh_summary(manifest)
    make_contact_sheet(manifest)
    dump_manifest(manifest)
    write_doc_manifest(manifest)
    print("Summary: " + json.dumps(manifest["summary"], ensure_ascii=False, sort_keys=True))
    return 0 if not manifest["summary"].get("failed_ids") else 1


if __name__ == "__main__":
    raise SystemExit(main())
