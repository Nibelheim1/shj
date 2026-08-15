# -*- coding: utf-8 -*-
"""把 volcengine 生成的横向序列图裁成单体透明 WebP，接入现有资产管线。"""
import glob
import os
import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, binary_dilation, distance_transform_edt, label

SRC = r"E:\Desktop\小动物山海经\art_tmp"
ROOT = r"E:\Desktop\小动物山海经"
CHAR_DIR = os.path.join(ROOT, "prototype", "assets", "art", "characters")
SECT_DIR = os.path.join(ROOT, "prototype", "assets", "art", "v7", "sect")
NPC_DIR = os.path.join(ROOT, "prototype", "assets", "art", "npc")

WHITE_V = 238
WHITE_S = 20
CLOSE_RADIUS = 14
FEATHER = 4


def find_by_stamp(stamp):
    hits = glob.glob(os.path.join(SRC, "*" + stamp + "*.png"))
    if not hits:
        raise FileNotFoundError(stamp)
    return hits[0]


def white_background_alpha(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    maxc = np.max(rgb, axis=2)
    minc = np.min(rgb, axis=2)
    v = maxc / 255.0
    s = np.where(maxc > 0, (maxc - minc) / np.maximum(maxc, 1e-8), 0.0)
    near = np.max(np.abs(rgb - 255.0), axis=2) <= 22
    white = ((v * 255.0 >= WHITE_V) & (s * 255.0 <= WHITE_S)) | near
    return white


def bg_alpha(image):
    rgb = image.convert("RGB")
    arr = np.asarray(rgb)
    white = white_background_alpha(arr)
    fg = ~white
    y, x = np.ogrid[-CLOSE_RADIUS:CLOSE_RADIUS + 1, -CLOSE_RADIUS:CLOSE_RADIUS + 1]
    disk = (x * x + y * y) <= CLOSE_RADIUS * CLOSE_RADIUS
    fg = binary_closing(fg, structure=disk, iterations=2)
    labels, num = label(~fg)
    border_labels = set()
    h, w = labels.shape
    border_labels.update(labels[0, :].tolist())
    border_labels.update(labels[-1, :].tolist())
    border_labels.update(labels[:, 0].tolist())
    border_labels.update(labels[:, -1].tolist())
    bg = np.isin(labels, list(border_labels))
    object_mask = ~bg
    dist = distance_transform_edt(object_mask)
    soft = np.clip(dist / max(1.0, FEATHER), 0.0, 1.0)
    alpha = (255.0 * soft).astype(np.uint8)
    return alpha


def tight_crop(rgba, pad=12):
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs) == 0:
        return rgba
    x0, x1 = max(0, xs.min() - pad), min(rgba.width, xs.max() + pad + 1)
    y0, y1 = max(0, ys.min() - pad), min(rgba.height, ys.max() + pad + 1)
    return rgba.crop((x0, y0, x1, y1))


def fit_canvas(rgba, size=512):
    rgba = tight_crop(rgba)
    rgba.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(rgba, ((size - rgba.width) // 2, (size - rgba.height) // 2), rgba)
    return canvas


def save_slices(src, count, out_prefix, size=512, target_dir=CHAR_DIR):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    step = w // count
    os.makedirs(target_dir, exist_ok=True)
    for i in range(count):
        crop = im.crop((i * step, 0, (i + 1) * step, h))
        alpha = bg_alpha(crop)
        rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
        out = os.path.join(target_dir, "%s%02d.webp" % (out_prefix, i + 1))
        if "%s%02d.webp" % (out_prefix, i + 1) == "stage_%02d.webp" % (i + 1):
            out = os.path.join(target_dir, "stage%02d.webp" % (i + 1))
        fit_canvas(rgba, size).save(out, "WEBP", quality=88, method=6)
        print(out)


def save_building_slices(src, count, area_ids, size=512):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    step = w // count
    os.makedirs(SECT_DIR, exist_ok=True)
    for i, area_id in enumerate(area_ids):
        crop = im.crop((i * step, 0, (i + 1) * step, h))
        alpha = bg_alpha(crop)
        rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
        canvas = fit_canvas(rgba, size)
        # 四个阶段先共用同一栋建筑基底，UI 用 stage 滤镜呈现荒废→焕新。
        for stage in range(4):
            out = os.path.join(SECT_DIR, "%s_stage%d.webp" % (area_id, stage))
            canvas.save(out, "WEBP", quality=88, method=6)
        print(out)


def main():
    beasts = {
        "dijiang": "T05-41-48",
        "bifang": "T05-44-25",
        "baize": "T05-46-08",
        "taowu": "T05-47-54",
        "zhulong": "T05-49-40",
        "pixiu": "T05-51-41",
        "qilin": "T05-53-29",
        "fenghuang": "T05-55-30",
        "kunpeng": "T05-57-13",
    }
    for beast_id, stamp in beasts.items():
        save_slices(find_by_stamp(stamp), 5, beast_id + "_lv", 512, CHAR_DIR)

    new_areas = [
        "workshop", "den", "canteen", "herb_garden", "alchemy",
        "library", "playground", "storage", "charm_altar", "cloud_isle"
    ]
    save_building_slices(find_by_stamp("T05-58-58"), 10, new_areas, 512)

    npc_ids = ["aluan", "squirrel", "deer", "rabbit", "badger", "sparrow"]
    save_slices(find_by_stamp("T06-00-57"), 6, "npc_", 320, NPC_DIR)
    # rename generic npc_XX to named files for UI data contract.
    for i, npc_id in enumerate(npc_ids, 1):
        old = os.path.join(NPC_DIR, "npc_%02d.webp" % i)
        new = os.path.join(NPC_DIR, npc_id + ".webp")
        if os.path.exists(old):
            os.replace(old, new)
            print(new)


if __name__ == "__main__":
    main()
