/* Offline artwork baking; no facility images are composited in the browser. */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'design/courtyard-flat-v1/source');
const output = path.join(root, 'prototype/assets/art/ui-v14/courtyard-flat');
const spec = require('../prototype/js/merge/courtyard-art.js');
const width = 896, height = 1568;
// Disjoint regions include every upgraded silhouette, its foundation and shadow.
// The rest of each theme is taken verbatim from its own approved level-one master.
const regions = {
  clinic:[0, .250, .402, .458],
  herb:[.520, .666, .985, .886],
  groom:[.005, .649, .365, .888],
  play:[.587, .286, .947, .511]
};
function bounds(id) {
  const [left, top, right, bottom] = regions[id];
  const x = Math.floor(left * width), y = Math.floor(top * height);
  return { left:x, top:y, width:Math.ceil(right * width) - x, height:Math.ceil(bottom * height) - y };
}
async function patch(image, id) {
  const rect = bounds(id);
  const { data, info } = await sharp(image).extract(rect).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
  const feather = 18;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const distance = Math.min(rect.left === 0 ? feather : x, info.width - 1 - x, y, info.height - 1 - y);
    const t = Math.max(0, Math.min(1, distance / feather));
    data[(y * info.width + x) * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
  }
  return { input:await sharp(data, { raw:info }).png().toBuffer(), left:rect.left, top:rect.top };
}
(async () => {
  fs.mkdirSync(output, { recursive:true });
  const frames = [];
  const themes = process.argv.includes('--day-only') ? ['courtyard'] : spec.themes;
  for (const theme of themes) {
    const masters = {};
    for (const level of [1, 2, 3]) {
      const file = path.join(source, `${theme}-${level}.png`);
      if (!fs.existsSync(file)) throw new Error(`Missing approved source: ${file}`);
      masters[level] = await sharp(file).resize(width, height, { fit:'fill' }).png().toBuffer();
    }
    const patches = {};
    for (const id of spec.order) {
      patches[id] = {};
      for (const level of [2, 3]) patches[id][level] = await patch(masters[level], id);
    }
    fs.mkdirSync(path.join(output, theme), { recursive:true });
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 3; c++) for (let d = 1; d <= 3; d++) {
      const levels = [a,b,c,d];
      const key = levels.join('');
      const overlays = spec.order.flatMap((id, index) => levels[index] > 1 ? [patches[id][levels[index]]] : []);
      const file = path.join(output, theme, `${key}.webp`);
      await sharp(masters[1]).composite(overlays).webp({ quality:84, effort:4 }).toFile(file);
      frames.push({ theme, key, bytes:fs.statSync(file).size });
    }
    console.log(`Baked ${theme}: 81 complete courtyard images`);
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ version:1, width, height, order:spec.order, themes, regions, frames }, null, 2) + '\n');
  console.log(`Total ${frames.length} images, ${(frames.reduce((n, frame) => n + frame.bytes, 0) / 1048576).toFixed(1)} MiB, maximum ${(Math.max(...frames.map(frame => frame.bytes)) / 1024).toFixed(0)} KiB`);
})().catch(error => { console.error(error); process.exitCode = 1; });
