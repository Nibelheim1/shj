const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');

function copy(from, to) {
  const source = path.join(root, from);
  const target = path.join(dist, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

let html = fs.readFileSync(path.join(root, 'prototype/merge_slice.html'), 'utf8');
let css = fs.readFileSync(path.join(root, 'prototype/merge-slice.css'), 'utf8');
let js = fs.readFileSync(path.join(root, 'prototype/merge-slice.js'), 'utf8');

// The source prototype runs from /prototype; the deploy artifact runs from /dist.
css = css.replaceAll("../wechat/assets/art/", "assets/art/");
js = js.replaceAll("../wechat/assets/art/", "assets/art/");
html = html.replace('merge_slice.html', 'index.html');

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, 'merge-slice.css'), css);
fs.writeFileSync(path.join(dist, 'merge-slice.js'), js);

for (const file of fs.readdirSync(path.join(root, 'wechat/assets/art/match3'))) {
  copy(`wechat/assets/art/match3/${file}`, `assets/art/match3/${file}`);
}
for (const file of ['qiongqi_s0.png', 'qiongqi_s1.png', 'qiongqi_s2.png', 'qiongqi_s3.png']) {
  copy(`wechat/assets/art/characters/${file}`, `assets/art/characters/${file}`);
}
copy('wechat/assets/art/scenes/bg_courtyard_v2.png', 'assets/art/scenes/bg_courtyard_v2.png');

console.log(`Built dist/ with ${fs.readdirSync(dist, { recursive: true }).length} files.`);
