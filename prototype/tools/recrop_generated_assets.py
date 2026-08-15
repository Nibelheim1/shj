# -*- coding: utf-8 -*-
"""按连通域重新裁切横向序列图，修复等距切片切到建筑/NPC的问题。"""
import glob
import os
import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, distance_transform_edt, label

SRC = r"E:\Desktop\小动物山海经\art_tmp"
ROOT = r"E:\Desktop\小动物山海经"
CHAR_DIR = os.path.join(ROOT, "prototype", "assets", "art", "characters")
SECT_DIR = os.path.join(ROOT, "prototype", "assets", "art", "v7", "sect")
NPC_DIR = os.path.join(ROOT, "prototype", "assets", "art", "npc")

WHITE_V = 238
WHITE_S = 20
CLOSE_RADIUS = 14
FEATHER = 5
PAD = 18


def find_by_stamp(stamp):
    hits = glob.glob(os.path.join(SRC, "*" + stamp + "*.png"))
    if not hits:
        raise FileNotFoundError(stamp)
    return hits[0]


def foreground_mask(rgb_arr):
    rgb = np.asarray(rgb_arr, dtype=np.float32)
    maxc = np.max(rgb, axis=2)
    minc = np.min(rgb, axis=2)
    v = maxc / 255.0
    s = np.where(maxc > 0, (maxc - minc) / np.maximum(maxc, 1e-8), 0.0)
    white = ((v * 255.0 >= WHITE_V) & (s * 255.0 <= WHITE_S)) | (np.max(np.abs(rgb - 255.0), axis=2) <= 22)
    fg = ~white
    y, x = np.ogrid[-CLOSE_RADIUS:CLOSE_RADIUS + 1, -CLOSE_RADIUS:CLOSE_RADIUS + 1]
    disk = (x * x + y * y) <= CLOSE_RADIUS * CLOSE_RADIUS
    return binary_closing(fg, structure=disk, iterations=2)


def component_boxes(mask, min_area, max_components):
    labels, num = label(mask)
    boxes = []
    h, w = mask.shape
    for label_id in range(1, num + 1):
        area = int((labels == label_id).sum())
        if area < min_area:
            continue
        ys, xs = np.where(labels == label_id)
        boxes.append((float(xs.mean()), int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), area))
    boxes.sort(key=lambda item: item[0])
    if len(boxes) > max_components:
        # 保留面积最大、且按横坐标均匀分布的组件。
        boxes.sort(key=lambda item: -item[5])
        boxes = boxes[:max_components]
        boxes.sort(key=lambda item: item[0])
    return boxes


def slice_union_boxes(mask, boxes, count):
    """把组件按横坐标归入 count 个横向槽位，并返回每个槽位的联合 bbox。"""
    h, w = mask.shape
    step = w / float(count)
    unions = [None] * count
    for centroid, x0, y0, x1, y1, _area in boxes:
        slot = min(count - 1, max(0, int(centroid / step)))
        if unions[slot] is None:
            unions[slot] = [x0, y0, x1, y1]
        else:
            u = unions[slot]
            u[0] = min(u[0], x0); u[1] = min(u[1], y0); u[2] = max(u[2], x1); u[3] = max(u[3], y1)
    result = []
    for i in range(count):
        if unions[i] is None:
            result.append((i * step, 0, (i + 1) * step - 1, h - 1))
        else:
            x0, y0, x1, y1 = unions[i]
            x0 = max(0, int(x0 - PAD)); y0 = max(0, int(y0 - PAD))
            x1 = min(w - 1, int(x1 + PAD)); y1 = min(h - 1, int(y1 + PAD))
            result.append((x0, y0, x1, y1))
    return result


def bg_alpha(crop_rgb):
    mask = foreground_mask(np.asarray(crop_rgb))
    labels, num = label(~mask)
    h, w = mask.shape
    border = set(labels[0, :].tolist()) | set(labels[-1, :].tolist()) | set(labels[:, 0].tolist()) | set(labels[:, -1].tolist())
    bg = np.isin(labels, list(border))
    object_mask = ~bg
    dist = distance_transform_edt(object_mask)
    soft = np.clip(dist / max(1.0, FEATHER), 0.0, 1.0)
    return (255.0 * soft).astype(np.uint8)


def fit_canvas(rgba, size):
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.where(alpha > 10)
    if len(xs):
        x0, x1 = max(0, xs.min() - 8), min(rgba.width, xs.max() + 9)
        y0, y1 = max(0, ys.min() - 8), min(rgba.height, ys.max() + 9)
        rgba = rgba.crop((x0, y0, x1, y1))
    rgba.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(rgba, ((size - rgba.width) // 2, (size - rgba.height) // 2), rgba)
    return canvas


def recrop(src, count, prefix, target_dir, size, min_area):
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im)
    mask = foreground_mask(arr)
    boxes = component_boxes(mask, min_area, count * 2)
    crops = slice_union_boxes(mask, boxes, count)
    os.makedirs(target_dir, exist_ok=True)
    for i, (x0, y0, x1, y1) in enumerate(crops, 1):
        crop = im.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
        alpha = bg_alpha(crop)
        rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
        out = os.path.join(target_dir, "%s_%d.webp" % (prefix, i))
        fit_canvas(rgba, size).save(out, "WEBP", quality=82, method=6)
        print(out)


def recrop_buildings(src, count, area_ids, size):
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im)
    mask = foreground_mask(arr)
    boxes = component_boxes(mask, 2500, count * 2)
    crops = slice_union_boxes(mask, boxes, count)
    os.makedirs(SECT_DIR, exist_ok=True)
    for i, area_id in enumerate(area_ids):
        x0, y0, x1, y1 = crops[i]
        crop = im.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
        alpha = bg_alpha(crop)
        rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
        canvas = fit_canvas(rgba, size)
        for stage in range(4):
            out = os.path.join(SECT_DIR, "%s_stage%d.webp" % (area_id, stage))
            canvas.save(out, "WEBP", quality=82, method=6)
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
        recrop(find_by_stamp(stamp), 5, beast_id + "_lv", CHAR_DIR, 384, 900)

    new_areas = [
        "workshop", "den", "canteen", "herb_garden", "alchemy",
        "library", "playground", "storage", "charm_altar", "cloud_isle"
    ]
    recrop_buildings(find_by_stamp("T05-58-58"), 10, new_areas, 384)

    npc_ids = ["aluan", "squirrel", "deer", "rabbit", "badger", "sparrow"]
    im = Image.open(find_by_stamp("T06-00-57")).convert("RGB")
    mask = foreground_mask(np.asarray(im))
    boxes = component_boxes(mask, 700, 12)
    crops = slice_union_boxes(mask, boxes, 6)
    os.makedirs(NPC_DIR, exist_ok=True)
    for i, npc_id in enumerate(npc_ids):
        x0, y0, x1, y1 = crops[i]
        crop = im.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))
        alpha = bg_alpha(crop)
        rgba = Image.merge("RGBA", (*crop.split(), Image.fromarray(alpha)))
        out = os.path.join(NPC_DIR, npc_id + ".webp")
        fit_canvas(rgba, 256).save(out, "WEBP", quality=82, method=6)
        print(out)


if __name__ == "__main__":
    main()
