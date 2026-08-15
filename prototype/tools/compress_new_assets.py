# -*- coding: utf-8 -*-
"""压缩新增生成资产，使 dist 总包保持 10 MiB 预算内。"""
import glob
import os
from PIL import Image

GROUPS = [
    ('characters', 'prototype/assets/art/characters/{id}_*.webp', ['dijiang', 'bifang', 'baize', 'taowu', 'zhulong', 'pixiu', 'qilin', 'fenghuang', 'kunpeng'], 384),
    ('sect buildings', 'prototype/assets/art/v7/sect/*_stage?.webp', None, 384),
    ('npc', 'prototype/assets/art/npc/*.webp', None, 256),
    ('charm icons', 'prototype/assets/art/match3/charm_*.webp', None, 256),
    ('treasure icons', 'prototype/assets/art/match3/treasure_*.webp', None, 256),
    ('feed high icons', 'prototype/assets/art/match3/feed_0[7-9].webp', None, 256),
    ('feed high icons', 'prototype/assets/art/match3/feed_10.webp', None, 256),
]

count = 0
for _label, pattern, ids, size in GROUPS:
    files = []
    if ids:
        for beast_id in ids:
            files.extend(glob.glob(pattern.format(id=beast_id)))
    else:
        files.extend(glob.glob(pattern))
    for path in files:
        im = Image.open(path).convert('RGBA')
        im.thumbnail((size, size), Image.LANCZOS)
        im.save(path, 'WEBP', quality=72, method=6)
        count += 1
print('recompressed', count)
