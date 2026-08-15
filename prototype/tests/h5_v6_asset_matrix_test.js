'use strict';

/* v6 asset matrix/release gate.  This is intentionally independent of a
 * browser: it catches missing source files, opaque "transparent" sprites,
 * oversized WebP files and assets the existing dist builder would omit. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(REPO, 'prototype');
const DIST = path.join(REPO, 'dist');
const DATA = require(path.join(SOURCE, 'js', 'merge', 'data.js'));
const MAX_BYTES = 1 * 1024 * 1024;

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log('  PASS  ' + label);
  } catch (error) {
    failures += 1;
    console.error('  FAIL  ' + label + ': ' + error.message);
  }
}

function expect(condition, message) {
  assert.ok(condition, message);
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch (_) { return false; }
}

function sourcePath(relative) {
  return path.resolve(SOURCE, relative.replace(/^\/+/, ''));
}

function distPath(relative) {
  return path.resolve(DIST, relative.replace(/^\/+/, ''));
}

function relAsset(value) {
  let result = String(value || '').replace(/\\/g, '/');
  result = result.replace(/^\.\//, '').replace(/^\.\.\//, '');
  const marker = result.indexOf('assets/art/');
  if (marker >= 0) result = result.slice(marker);
  return result;
}

function relSceneAsset(value) {
  const result = relAsset(value);
  return result.startsWith('assets/') ? result : 'assets/art/scenes/' + result;
}

function chunkList(buffer) {
  const chunks = [];
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return chunks;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start > buffer.length) break;
    chunks.push({ type, start, end: Math.min(buffer.length, start + length), length });
    offset = start + length + (length & 1);
  }
  return chunks;
}

function webpAlpha(buffer) {
  const chunks = chunkList(buffer);
  const vp8x = chunks.find((chunk) => chunk.type === 'VP8X');
  const alphaChunk = chunks.some((chunk) => chunk.type === 'ALPH');
  /* VP8L carries an `alpha_is_used` bit in its five-byte bitstream header;
   * merely being lossless does not prove that pixels have an alpha plane. */
  const vp8l = chunks.find((chunk) => chunk.type === 'VP8L');
  let losslessAlpha = false;
  if (vp8l && vp8l.end - vp8l.start >= 5 && buffer[vp8l.start] === 0x2f) {
    /* Header bits are little-endian: signature (8), width (14), height (14),
     * then alpha_is_used (1), version (3). The alpha flag begins at bit 36. */
    losslessAlpha = !!(buffer[vp8l.start + 4] & 0x10);
  }
  const explicit = !!(vp8x && (buffer[vp8x.start] & 0x10));
  const channel = explicit || alphaChunk || losslessAlpha;
  return { channel, effective: channel };
}

/* PNG parser used only for diagnostics when a stale source still has PNG.
 * WebP is the required v6 format; the parser keeps the failure message
 * actionable instead of treating a PNG as an opaque unknown. */
function pngAlpha(buffer) {
  if (buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47) return { channel: false, effective: false };
  let offset = 8;
  let bitDepth = 0;
  let colorType = 0;
  let idat = [];
  let hasTransparencyTable = false;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const payload = buffer.subarray(start, start + size);
    if (type === 'IHDR' && payload.length >= 10) {
      bitDepth = payload[8];
      colorType = payload[9];
    } else if (type === 'IDAT') idat.push(payload);
    else if (type === 'tRNS') hasTransparencyTable = true;
    offset = start + size + 4;
    if (type === 'IEND') break;
  }
  const channel = colorType === 4 || colorType === 6 || (colorType === 3 && hasTransparencyTable);
  if (!channel || bitDepth !== 8 || !idat.length) return { channel, effective: channel };
  let decoded;
  try { decoded = zlib.inflateSync(Buffer.concat(idat)); } catch (_) { return { channel, effective: false }; }
  /* Decode enough of each scanline to see whether any alpha byte is <255. */
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : 0;
  if (!channels || !width || !height) return { channel, effective: channel };
  const rowBytes = width * channels;
  const rows = [];
  let cursor = 0;
  const prior = Buffer.alloc(rowBytes);
  for (let row = 0; row < height; row += 1) {
    if (cursor >= decoded.length) return { channel, effective: false };
    const filter = decoded[cursor++];
    const current = Buffer.from(decoded.subarray(cursor, cursor + rowBytes));
    cursor += rowBytes;
    if (current.length !== rowBytes) return { channel, effective: false };
    for (let i = 0; i < rowBytes; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = prior[i] || 0;
      const upLeft = i >= channels ? prior[i - channels] || 0 : 0;
      if (filter === 1) current[i] = (current[i] + left) & 255;
      else if (filter === 2) current[i] = (current[i] + up) & 255;
      else if (filter === 3) current[i] = (current[i] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        current[i] = (current[i] + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 255;
      } else if (filter !== 0) return { channel, effective: false };
    }
    rows.push(current);
    current.copy(prior);
  }
  const alphaOffset = colorType === 6 ? 3 : 1;
  for (const row of rows) for (let i = alphaOffset; i < row.length; i += channels) {
    if (row[i] < 255) return { channel: true, effective: true };
  }
  return { channel: true, effective: false };
}

function alphaInfo(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (path.extname(filePath).toLowerCase() === '.webp') return webpAlpha(buffer);
  if (path.extname(filePath).toLowerCase() === '.png') return pngAlpha(buffer);
  return { channel: false, effective: false };
}

function expectedMatrix() {
  const icons = [];
  Object.keys(DATA.families || {}).forEach((id) => {
    const family = DATA.families[id];
    const basename = family.path || id;
    for (let tier = 1; tier <= 6; tier += 1) {
      /* v6 ships the matrix as WebP even when an older data reader still says
       * .png; preserving the basename keeps old callers source-compatible. */
      icons.push({ key: id + ':' + tier, relative: 'assets/art/match3/' + basename + '_' + String(tier).padStart(2, '0') + '.webp', transparent: true });
    }
  });
  const buildings = [];
  Object.keys(DATA.buildings || {}).forEach((id) => {
    const definition = DATA.buildings[id];
    const art = Array.isArray(definition.art) ? definition.art : [];
    for (let level = 1; level <= 3; level += 1) {
      const value = art[level - 1] || ('assets/art/buildings/' + id + '_lv' + level + '.webp');
      buildings.push({ key: id + ':lv' + level, relative: relAsset(value), transparent: true });
    }
  });
  const fox = [];
  const atlases = [];
  const foxDefinition = (DATA.beasts || []).find((beast) => beast.id === 'jiuweihu');
  const levels = foxDefinition && Array.isArray(foxDefinition.levels) ? foxDefinition.levels : [];
  for (let index = 0; index < 5; index += 1) {
    const level = levels[index] || {};
    fox.push({ key: 'jiuweihu:lv' + (index + 1), relative: relAsset(level.portrait || ('assets/art/characters/jiuweihu_lv' + (index + 1) + '.webp')), transparent: true });
    atlases.push({ key: 'jiuweihu:atlas' + (index + 1), relative: relAsset(level.atlas || ('assets/art/characters/jiuweihu_lv' + (index + 1) + '_atlas.webp')), transparent: true });
  }
  const day7 = DATA.signIn && Array.isArray(DATA.signIn.days) && DATA.signIn.days.find((day) => Number(day.day) === 7);
  const backgroundId = day7 && day7.background;
  const background = (DATA.backgrounds || []).find((value) => value.id === backgroundId);
  const limited = background ? [{ key: 'background:' + background.id, relative: relSceneAsset(background.file), transparent: false }] : [];
  return { icons, buildings, fox, atlases, limited };
}

function assertMatrixFiles(entries, label) {
  expect(entries.length > 0, label + ' matrix is empty');
  const issues = [];
  entries.forEach((entry) => {
    try {
      expect(entry.relative.toLowerCase().endsWith('.webp'), label + ' ' + entry.key + ' must be WebP');
      const source = sourcePath(entry.relative);
      expect(isFile(source), label + ' missing source ' + entry.relative);
      if (!isFile(source)) return;
      const bytes = fs.statSync(source).size;
      expect(bytes <= MAX_BYTES, label + ' ' + entry.relative + ' exceeds 1 MiB (' + bytes + ' bytes)');
      const alpha = alphaInfo(source);
      if (entry.transparent) expect(alpha.channel && alpha.effective,
        label + ' ' + entry.relative + ' must have effective transparency');
      const deployed = distPath(entry.relative);
      expect(isFile(deployed), label + ' missing dist asset (404) ' + entry.relative);
      if (isFile(deployed)) expect(fs.statSync(deployed).size <= MAX_BYTES,
        label + ' dist asset exceeds 1 MiB ' + entry.relative);
    } catch (error) {
      issues.push(error.message);
    }
  });
  if (issues.length) {
    const shown = issues.slice(0, 24);
    const suffix = issues.length > shown.length ? ' ... +' + (issues.length - shown.length) + ' more' : '';
    throw new Error(label + ' has ' + issues.length + ' issue(s): ' + shown.join(' | ') + suffix);
  }
}

console.log('\n== H5 v6 asset matrix/release contract ==');
const matrix = expectedMatrix();

check('资产矩阵数量固定：48图标 + 12建筑 + 5狐立绘 + 5图集 + 1限定背景', function () {
  expect(matrix.icons.length === 48, 'icon matrix must contain 48 entries');
  expect(matrix.buildings.length === 12, 'building matrix must contain 12 entries');
  expect(matrix.fox.length === 5, 'fox portrait matrix must contain 5 entries');
  expect(matrix.atlases.length === 5, 'fox atlas matrix must contain 5 entries');
  expect(matrix.limited.length === 1, 'sign-in limited background must be declared');
  const all = [].concat(matrix.icons, matrix.buildings, matrix.fox, matrix.atlases, matrix.limited);
  expect(new Set(all.map((entry) => entry.relative)).size === all.length, 'asset matrix paths must be unique');
});

check('源文件/ dist 文件均存在、WebP、<=1MiB、透明资源 alpha 有效', function () {
  const issues = [];
  [[matrix.icons, '48 icons'], [matrix.buildings, '12 buildings'],
    [matrix.fox, '5 fox portraits'], [matrix.atlases, '5 fox atlases'],
    [matrix.limited, 'limited background']].forEach(([entries, label]) => {
    try { assertMatrixFiles(entries, label); } catch (error) { issues.push(error.message); }
  });
  if (issues.length) throw new Error(issues.join(' || '));
});

check('现有构建脚本能带入矩阵，且入口引用无源/dist 404', function () {
  const buildFile = path.join(REPO, 'build-dist.js');
  expect(isFile(buildFile), 'build-dist.js must exist');
  const build = fs.readFileSync(buildFile, 'utf8');
  expect(/prototype\/assets\/art\/match3/.test(build), 'build must copy match3 assets');
  expect(/prototype\/assets\/art\/buildings/.test(build), 'build must copy building assets');
  expect(/prototype\/assets\/art\/characters/.test(build), 'build must copy character assets');
  /* Character lv/atlas and sign-in background files are not in the legacy
   * four-beast s0..s3 loop; the builder must explicitly copy or recursively
   * include them or dist will 404 despite a valid source matrix. */
  expect(/jiuweihu_lv|copyDirectoryIfPresent\(['"]prototype\/assets\/art\/characters/.test(build),
    'build must include v6 fox portrait/atlas assets');
  expect(/fox-lantern|RELEASE_SCENES/.test(build),
    'build must include the sign-in limited background');

  const htmlFiles = [path.join(SOURCE, 'merge_slice.html'), path.join(DIST, 'index.html')].filter(isFile);
  const refs = new Set();
  htmlFiles.forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:src|href)=["']([^"']*assets\/art\/[^"']+)["']/gi)) {
      const value = match[1].split(/[?#]/)[0];
      if (/\.webp$|\.png$/i.test(value)) refs.add(relAsset(value));
    }
  });
  refs.forEach((relative) => {
    expect(isFile(sourcePath(relative)), 'entry source reference 404: ' + relative);
    expect(isFile(distPath(relative)), 'entry dist reference 404: ' + relative);
  });
});

console.log('\n== asset matrix result ==');
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAIL');
process.exitCode = failures === 0 ? 0 : 1;
