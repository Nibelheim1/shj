/*
 * Player-copy audit for the merge H5 slice.
 *
 * This gate keeps implementation/project language out of the player-facing
 * surface.  It intentionally scans ui.js as well as the static entry page:
 * ui.js is owned by another worker in this pass, so any remaining hits are
 * printed with line numbers for that worker to replace.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_ROOT = path.join(ROOT, 'prototype');
const HTML_PATH = path.join(SOURCE_ROOT, 'merge_slice.html');
const UI_PATH = path.join(SOURCE_ROOT, 'js', 'merge', 'ui.js');

/*
 * These are copy-level phrases, rather than gameplay terms.  Keep the rules
 * deliberately phrase-oriented so useful words such as “永久生效” or
 * “尚未解锁” remain valid game language.
 */
const COPY_RULES = [
  { id: 'prototype', label: '原型', pattern: /原型/g },
  { id: 'validation-copy', label: '验证版/验证范围', pattern: /验证版|验证范围|玩法闭环/g },
  { id: 'round-language', label: '本轮', pattern: /本轮/g },
  { id: 'unwired-real-feature', label: '真实功能未接入', pattern: /真实[^。！？；\n]{0,32}(?:未接入|不在)/g },
  { id: 'hidden-tuning', label: '不会暗调', pattern: /不会暗调/g },
  { id: 'permanent-order', label: '永久委托/永久槽位', pattern: /永久委托|永久槽位/g },
  { id: 'preview-version', label: '版本预览/降级覆盖', pattern: /当前仅预览|更高版本存档|不会降级覆盖/g },
  { id: 'save-migration-jargon', label: '存档迁移说明', pattern: /主存档校验失败|安全备份|旧版备份|旧版进度|无损迁移/g },
  { id: 'numeric-settlement', label: '无数值结算', pattern: /无数值结算/g },
  { id: 'technical-h5-label', label: 'H5 技术标签', pattern: /\bH5\b/g }
];

const ORGANIZE_RULES = [
  { id: 'organize-board-id', label: 'organize board DOM/identifier', pattern: /organize(?:[-_]?(?:board|btn)|Board)/g },
  { id: 'organize-board-copy', label: '整理棋盘', pattern: /整理棋盘/g }
];

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing required file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function lineAt(source, offset) {
  return source.slice(0, Math.max(0, offset)).split(/\r?\n/).length;
}

function withGlobal(pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  return new RegExp(pattern.source, flags);
}

function scanText(value, rules, context, source, offset) {
  const hits = [];
  for (const rule of rules) {
    const expression = withGlobal(rule.pattern);
    for (const match of value.matchAll(expression)) {
      const localOffset = (offset == null ? 0 : offset) + (match.index || 0);
      hits.push({
        rule: rule.id,
        label: rule.label,
        context,
        value: match[0],
        line: source ? lineAt(source, localOffset) : null
      });
    }
  }
  return hits;
}

/*
 * Pull quoted JavaScript literals without evaluating ui.js.  This is enough
 * for the player copy audit and skips comments so implementation notes do not
 * become false positives.  Template literals are retained as one literal;
 * their static copy is still visible when rendered.
 */
function extractJsLiterals(source) {
  const literals = [];
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (current !== "'" && current !== '"' && current !== '`') {
      index += 1;
      continue;
    }

    const quote = current;
    const start = index;
    index += 1;
    let value = '';
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        value += character;
        if (index + 1 < source.length) value += source[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) {
        literals.push({ value, offset: start });
        index += 1;
        break;
      }
      value += character;
      index += 1;
    }
  }
  return literals;
}

function visibleHtmlFragments(html) {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const fragments = [];
  const ignored = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);
  const attributes = ['aria-label', 'title', 'alt', 'placeholder', 'value'];

  const walker = document.createTreeWalker(document.body, dom.window.NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (ignored.has(node.parentElement && node.parentElement.tagName)) continue;
    const value = String(node.nodeValue || '').trim();
    if (value) fragments.push({ kind: 'text', value });
  }

  for (const element of document.querySelectorAll('*')) {
    if (ignored.has(element.tagName)) continue;
    for (const attribute of attributes) {
      if (!element.hasAttribute(attribute)) continue;
      const value = String(element.getAttribute(attribute) || '').trim();
      if (value) fragments.push({ kind: `@${attribute}`, value });
    }
  }
  return { document, fragments };
}

function reportHits(label, hits) {
  if (!hits.length) {
    console.log(`PASS  ${label}`);
    return;
  }
  console.log(`FAIL  ${label} (${hits.length})`);
  for (const hit of hits) {
    const location = hit.line == null ? '' : `:${hit.line}`;
    console.log(`  - ${hit.context}${location} · ${hit.label} · ${hit.value}`);
  }
}

function dedupeHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const key = [hit.rule, hit.line, hit.value].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const html = readRequired(HTML_PATH);
const ui = readRequired(UI_PATH);
const { document, fragments } = visibleHtmlFragments(html);
const failures = [];

console.log('== H5 player-copy audit ==');

/* Static page: source scan catches attributes and preserves useful line refs. */
const htmlCopyHits = scanText(html, COPY_RULES, 'merge_slice.html', html, 0);
const htmlOrganizeHits = scanText(html, ORGANIZE_RULES, 'merge_slice.html', html, 0);
const domCopyHits = fragments.flatMap((fragment) => scanText(fragment.value, COPY_RULES, `DOM ${fragment.kind}`));
const domOrganizeHits = fragments.flatMap((fragment) => scanText(fragment.value, ORGANIZE_RULES, `DOM ${fragment.kind}`));

reportHits('merge_slice.html copy', htmlCopyHits.concat(domCopyHits));
reportHits('merge_slice.html organize-board DOM/copy', htmlOrganizeHits.concat(domOrganizeHits));

if (document.getElementById('organize-btn')) {
  failures.push({ context: 'merge_slice.html', label: 'organize-btn must be removed', value: 'organize-btn' });
}

/* ui.js: only quoted literals are copy; identifiers are checked separately. */
const jsLiterals = extractJsLiterals(ui);
/* The source pass catches copy split across concatenated literals and legacy
 * save-status strings.  Deduplication keeps one actionable hit per line. */
const uiCopyHits = dedupeHits(
  jsLiterals.flatMap((literal) => scanText(literal.value, COPY_RULES, 'ui.js', ui, literal.offset))
    .concat(scanText(ui, COPY_RULES, 'ui.js', ui, 0))
);
const uiOrganizeCopyHits = dedupeHits(
  jsLiterals.flatMap((literal) => scanText(literal.value, ORGANIZE_RULES, 'ui.js', ui, literal.offset))
    .concat(scanText(ui, ORGANIZE_RULES, 'ui.js', ui, 0))
);

reportHits('ui.js player copy (pending replacements)', uiCopyHits);
reportHits('ui.js organize-board references (pending removal)', uiOrganizeCopyHits);

failures.push(...htmlCopyHits, ...domCopyHits, ...htmlOrganizeHits, ...domOrganizeHits);
failures.push(...uiCopyHits, ...uiOrganizeCopyHits);

if (failures.length) {
  console.log(`\nH5 PLAYER COPY AUDIT FAIL (${failures.length} hit(s)); see ui.js lines above for pending replacements.`);
  process.exitCode = 1;
} else {
  console.log('\nH5 PLAYER COPY AUDIT PASS (no project copy or organize-board references)');
}
