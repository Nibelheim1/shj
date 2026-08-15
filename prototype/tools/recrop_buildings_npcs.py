# -*- coding: utf-8 -*-
"""按视觉模型标定的横向位置比例重新裁切建筑与NPC序列图。"""
import os
import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, distance_transform_edt, label

ROOT = r"E:\Desktop\小动物山海经"
SRC = os.path.join(ROOT, "art_tmp")
SECT_DIR = os.path.join(ROOT, "prototype", "assets", "art", "v7", "sect")
NPC_DIR = os.path.join(ROOT, "prototype", "assets", "art", "npc")

WHITE_V = 238
WHITE_S = 20
CLOSE_RADIUS = 14
FEATHER = 5
PAD_PX = 0


def find_by_stamp(stamp):
    import glob
    hits = glob.glob(os.path.join(SRC, "*" + stamp + "*.png"))
    if not hits:
        raise FileNotFoundError(stamp)
    return hits[0]


def bg_alpha(crop_rgb):
    arr = np.asarray(crop_rgb, dtype=np.float32)
    maxc = np.max(arr, axis=2)
    minc = np.min(arr, axis=2)
    v = maxc / 255.0
    s = np.where(maxc > 0, (maxc - minc) / np.maximum(maxc, 1e-8), 0.0)
    white = ((v * 255.0 >= WHITE_V) & (s * 255.0 <= WHITE_S)) | (np.max(np.abs(arr - 255.0), axis=2) <= 22)
    fg = ~white
    y, x = np.ogrid[-CLOSE_RADIUS:CLOSE_RADIUS + 1, -CLOSE_RADIUS:CLOSE_RADIUS + 1]
    disk = (x * x + y * y) <= CLOSE_RADIUS * CLOSE_RADIUS
    fg = binary_closing(fg, structure=disk, iterations=2)
    labels, num = label(~fg)
    border = set(labels[0, :].tolist()) | set(labels[-1, :].tolist()) | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    bg = np.isin(labels, list(border))
    dist = distance_transform_edt(~bg)
    soft = np.clip(dist / max(1.0, FEATHER), 0.0, 1.0)
    return (255.0 * soft).astype(np.uint8)


def tight_fit(rgba, size):
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs):
        x0, x1 = max(0, xs.min() - 6), min(rgba.width, xs.max() + 7)
        y0, y1 = max(0, ys.min() - 6), min(rgba.height, ys.max() + 7)
        rgba = rgba.crop((x0, y0, x1, y1))
    rgba.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(rgba, ((size - rgba.width) // 2, (size - rgba.height) // 2), rgba)
    return canvas


def crop_ranges(image, ranges):
    w, h = image.size
    out = []
    for left, right in ranges:
        x0 = max(0, int(left * w)); x1 = min(w - 1, int(right * w) - 1)
        x0 = max(0, x0 - PAD_PX); x1 = min(w - 1, x1 + PAD_PX)
        out.append(image.crop((x0, 0, x1 + 1, h)))
    return out


def save_transparent(crop, path, size):
    alpha = bg_alpha(crop)
    rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
    canvas = tight_fit(rgba, size)
    for attempt in range(4):
        tmp = path + ".tmp"
        try:
            with open(tmp, "wb") as fp:
                canvas.save(fp, "WEBP", quality=82, method=6)
            os.replace(tmp, path)
            print(path)
            return
        except OSError:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except OSError:
                pass
            import time
            time.sleep(0.2)
    raise RuntimeError("cannot save " + path)


def main():
    building_img = Image.open(find_by_stamp("T05-58-58")).convert("RGB")
    building_ranges = [
        (0.02, 0.12), (0.12, 0.215), (0.215, 0.31), (0.31, 0.41), (0.41, 0.52),
        (0.52, 0.62), (0.62, 0.72), (0.72, 0.80), (0.80, 0.90), (0.90, 1.00)
    ]
    area_ids = ["workshop", "den", "canteen", "herb_garden", "alchemy", "library", "playground", "storage", "charm_altar", "cloud_isle"]
    os.makedirs(SECT_DIR, exist_ok=True)
    for crop, area_id in zip(crop_ranges(building_img, building_ranges), area_ids):
        for stage in range(4):
            save_transparent(crop, os.path.join(SECT_DIR, "%s_stage%d.webp" % (area_id, stage)), 384)

    npc_img = Image.open(find_by_stamp("T07-11-32")).convert("RGB")
    npc_ranges = [(0.00, 0.095), (0.095, 0.24), (0.24, 0.42), (0.42, 0.58), (0.58, 0.78), (0.78, 1.00)]
    npc_ids = ["aluan", "squirrel", "deer", "rabbit", "badger", "sparrow"]
    os.makedirs(NPC_DIR, exist_ok=True)
    for crop, npc_id in zip(crop_ranges(npc_img, npc_ranges), npc_ids):
        save_transparent(crop, os.path.join(NPC_DIR, npc_id + ".webp"), 256)


if __name__ == "__main__":
    main()
