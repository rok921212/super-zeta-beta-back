// The overlay package (`.zip`): a graphic made outside the Designer — or a
// Designer design exported for someone else — in one file anybody can author.
//
//   overlay.json   required manifest (below)
//   index.html     markup; a whole document is fine (<style>, <link> to a CSS
//                  file in the zip and <body> are unpacked; <script> is dropped)
//   style.css      styles + @keyframes (animation is CSS only — no JavaScript)
//   assets/…       png | jpg | webp | gif | svg, referenced relatively (assets/logo.png)
//   fonts/…        .woff2 (listed in the manifest, or declared with @font-face in the CSS)
//   preview.png    optional thumbnail (kept for sharing later)
//   design.json    kind "design" only: a full Designer document
//
//   overlay.json = {
//     format: "scoresync-overlay", version: 1, kind: "html" | "design",
//     name, description?, author?: { name, url? }, license?, tags?: [],
//     canvas?: { width, height, background? },
//     layers?: [{ name?, html, css?, x?, y?, width?, height? }],   (kind html; default: index.html + style.css, full canvas)
//     fonts?:  [{ family, file }]
//   }
//
// kind "html" -> one `css` layer per entry (the layer type the editor already
// renders in a sandboxed shadow root); live data uses {{path|format}} tokens.
// kind "design" -> design.json as-is, images under assets/<24-hex id>.<ext>.
// Either way an image comes back as { id, name, data } and the draft refers to
// it as `asset:<id>`; the controller swaps those ids for the importing
// account's own copies (remapAssets), exactly like a .sstheme import.
//
// Pure functions only — no Express, no stores (controller/themePack.controller.js).

const crypto = require('crypto');
const path = require('path').posix;
const { unzipSync, zipSync, strToU8 } = require('fflate');
const schema = require('../utils/layoutSchema.generated.cjs');

const FORMAT = 'scoresync-overlay';
const PACKAGE_VERSION = 1;
const FILE_EXTENSION = '.zip';
/** Upload limit for an import (the zip). */
const MAX_PACKAGE_BYTES = 24 * 1024 * 1024;
/** Everything inside, uncompressed (zip-bomb guard: checked before inflating). */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 200;
const MAX_LAYERS = 20;
const MAX_FONTS = 30;
const MAX_ASSETS = 80;
const MAX_TEXT_BYTES = 512 * 1024;
const CANVAS_MIN = 16;
const CANVAS_MAX = 7680;

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const ASSET_ID_RE = /^[a-f0-9]{24}$/;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ext = (p) => path.extname(p).slice(1).toLowerCase();
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isRemote = (u) => /^(https?:|data:|asset:|#|\/\/|\/)/i.test(u);
const placeholderId = (p) => crypto.createHash('sha256').update(`pkg:${p}`).digest('hex').slice(0, 24);

/** "./a\\b/../c.png" -> "a/c.png"; null when it climbs out of the package or is absolute. */
function cleanPath(raw) {
  const p = String(raw).replace(/\\/g, '/');
  if (/^([a-z]:)?\//i.test(p)) return null;
  const n = path.normalize(p);
  if (n === '..' || n.startsWith('../')) return null;
  return n.replace(/^\.\//, '');
}

/** The zip's entries as { path: Uint8Array }, limits enforced before anything inflates. */
function readZip(buf) {
  const tooBig = { error: 'Package is too large once unpacked' };
  let count = 0;
  let total = 0;
  let problem = null;
  let files;
  try {
    files = unzipSync(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), {
      filter(f) {
        if (problem) return false;
        if (f.name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store$|Thumbs\.db$)/.test(f.name)) return false;
        if (++count > MAX_ENTRIES) { problem = { error: `Package has more than ${MAX_ENTRIES} files` }; return false; }
        total += f.originalSize;
        if (total > MAX_INFLATED_BYTES) { problem = tooBig; return false; }
        return true;
      },
    });
  } catch {
    return { error: 'Package is damaged or not a .zip file' };
  }
  if (problem) return problem;
  const out = new Map();
  let inflated = 0;
  for (const [name, data] of Object.entries(files)) {
    const p = cleanPath(name);
    if (p === null) return { error: `Package has an unsafe path: "${name}"` };
    inflated += data.length;
    if (inflated > MAX_INFLATED_BYTES) return tooBig;
    out.set(p, Buffer.from(data.buffer, data.byteOffset, data.length));
  }
  // A zipped folder: everything sits under one top directory.
  if (!out.has('overlay.json')) {
    const tops = new Set([...out.keys()].map((p) => p.split('/')[0]));
    if (tops.size === 1) {
      const [top] = tops;
      if (out.has(`${top}/overlay.json`)) {
        const strip = new Map();
        for (const [p, d] of out) strip.set(p.slice(top.length + 1), d);
        return { files: strip };
      }
    }
  }
  return { files: out };
}

function textOf(files, p, warnings, label) {
  const data = files.get(p);
  if (!data) return null;
  if (data.length > MAX_TEXT_BYTES) { warnings.push(`${label || p} is larger than ${MAX_TEXT_BYTES / 1024} KB and was skipped.`); return null; }
  return data.toString('utf8').replace(/^﻿/, '');
}

function cleanManifest(raw) {
  const author = isPlainObject(raw.author) ? raw.author : typeof raw.author === 'string' ? { name: raw.author } : {};
  const url = str(author.url, 300);
  const canvas = isPlainObject(raw.canvas) ? raw.canvas : {};
  const size = (v, d) => (Number.isFinite(Number(v)) ? Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, Math.round(Number(v)))) : d);
  const bg = str(canvas.background, 60);
  return {
    format: FORMAT,
    version: PACKAGE_VERSION,
    kind: raw.kind === 'design' ? 'design' : 'html',
    name: str(raw.name, 120) || 'Imported overlay',
    description: str(raw.description, 500),
    author: { name: str(author.name, 80), url: /^https:\/\//i.test(url) && schema.isSafeUrl(url) ? url : '' },
    license: str(raw.license, 60),
    // Same rule as library tags (controller/overlayLayout.controller.js checkLibraryMeta).
    tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => str(t, 30).replace(/\s+/g, ' ')).filter((t) => /^[^\u0000-\u001f<>,]{1,30}$/.test(t)))].slice(0, 12),
    canvas: { width: size(canvas.width, 1920), height: size(canvas.height, 1080), background: bg && bg.toLowerCase() !== 'transparent' ? bg : null },
  };
}

/**
 * Collects the images a layer's HTML/CSS points at inside the package and
 * rewrites those references to `asset:<placeholder>`. `base` = the directory of
 * the file the text came from.
 */
function makeAssetResolver(files, assets, warnings) {
  const byPath = new Map();
  return function resolve(ref, base) {
    const raw = ref.trim().replace(/^["']|["']$/g, '').trim();
    if (!raw || isRemote(raw)) return null;
    const clean = raw.split(/[?#]/)[0];
    let p;
    try { p = cleanPath(path.join(base, decodeURI(clean))); } catch { p = cleanPath(path.join(base, clean)); }
    if (p === null || !files.has(p)) {
      warnings.push(`"${raw}" is referenced but is not in the package.`);
      return null;
    }
    if (!IMAGE_MIME[ext(p)]) return null; // fonts and css are handled elsewhere
    if (!byPath.has(p)) {
      if (assets.length >= MAX_ASSETS) { warnings.push(`More than ${MAX_ASSETS} images: "${p}" was skipped.`); return null; }
      const id = placeholderId(p);
      byPath.set(p, id);
      assets.push({ id, name: path.basename(p).slice(0, 120), data: files.get(p) });
    }
    return `asset:${byPath.get(p)}`;
  };
}

function rewriteCss(css, base, resolve) {
  return css.replace(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (m, q, ref) => {
    const to = resolve(ref, base);
    return to ? `url("${to}")` : m;
  });
}

function rewriteHtml(html, base, resolve) {
  return html
    .replace(/(\s(?:src|href|poster|xlink:href)\s*=\s*)(["'])([^"']*)\2/gi, (m, attr, q, ref) => {
      const to = resolve(ref, base);
      return to ? `${attr}${q}${to}${q}` : m;
    })
    .replace(/(\sstyle\s*=\s*)(["'])([^"']*)\2/gi, (m, attr, q, css) => `${attr}${q}${rewriteCss(css, base, resolve)}${q}`);
}

/** @font-face blocks pointing at a .woff2 in the package -> the account's font library. */
function extractFontFaces(css, base, files, fonts, warnings) {
  return css.replace(/@font-face\s*\{([^}]*)\}/gi, (block, body) => {
    const fam = /font-family\s*:\s*(['"]?)([^;'"]+)\1/i.exec(body);
    const src = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/i.exec(body);
    if (!fam || !src || isRemote(src[2])) return block; // a remote font: leave it to the sanitiser
    const p = cleanPath(path.join(base, src[2].split(/[?#]/)[0]));
    if (p === null || !files.has(p)) { warnings.push(`Font file "${src[2]}" is not in the package.`); return ''; }
    if (ext(p) !== 'woff2') { warnings.push(`Font "${fam[2].trim()}" is not a .woff2 file and was skipped.`); return ''; }
    addFont(fonts, fam[2].trim(), files.get(p));
    return '';
  });
}

function addFont(fonts, family, data) {
  const f = family.replace(/\s+/g, ' ').trim();
  if (!f || fonts.some((x) => x.family.toLowerCase() === f.toLowerCase())) return;
  if (fonts.length < MAX_FONTS) fonts.push({ family: f, data });
}

/** A whole HTML document -> its body markup + the CSS it carries (inline <style> and local <link>s). */
function unpackDocument(text, base, files, warnings) {
  let html = text;
  let css = '';
  const linked = new Set();
  if (/<\s*script\b/i.test(html)) {
    html = html.replace(/<\s*script\b[\s\S]*?<\s*\/\s*script\s*>/gi, '').replace(/<\s*script\b[^>]*\/?>/gi, '');
    warnings.push('Scripts were removed: packages animate with CSS only.');
  }
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = /href\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    if (!/rel\s*=\s*(["'])?stylesheet/i.test(tag) || !href) return '';
    if (isRemote(href[2])) { warnings.push(`External stylesheet "${href[2]}" is not supported and was removed.`); return ''; }
    const p = cleanPath(path.join(base, href[2]));
    const sheet = p && textOf(files, p, warnings);
    if (sheet == null) { warnings.push(`Stylesheet "${href[2]}" is not in the package.`); return ''; }
    linked.add(p);
    css += `${sheet}\n`;
    return '';
  });
  html = html.replace(/<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi, (m, body) => { css += `${body}\n`; return ''; });
  const body = /<\s*body\b[^>]*>([\s\S]*?)(<\s*\/\s*body\s*>|$)/i.exec(html);
  if (body) html = body[1];
  else html = html.replace(/<!doctype[^>]*>/i, '').replace(/<\s*head\b[\s\S]*?<\s*\/\s*head\s*>/i, '').replace(/<\s*\/?\s*html\b[^>]*>/gi, '');
  return { html: html.trim(), css: css.trim(), linked };
}

function htmlDraft(files, rawManifest, manifest, warnings) {
  const assets = [];
  const fonts = [];
  const resolve = makeAssetResolver(files, assets, warnings);
  const { width: W, height: H } = manifest.canvas;
  const rawLayers = Array.isArray(rawManifest.layers) && rawManifest.layers.length
    ? rawManifest.layers
    : [{ name: manifest.name, html: 'index.html', css: files.has('style.css') ? 'style.css' : undefined }];
  if (rawLayers.length > MAX_LAYERS) return { error: `Package has more than ${MAX_LAYERS} layers` };

  const elements = [];
  for (let i = 0; i < rawLayers.length; i++) {
    const l = isPlainObject(rawLayers[i]) ? rawLayers[i] : {};
    const label = str(l.name, 80) || `Layer ${i + 1}`;
    const htmlPath = typeof l.html === 'string' ? cleanPath(l.html) : null;
    if (!htmlPath || !files.has(htmlPath)) return { error: `Layer "${label}": HTML file "${l.html || 'index.html'}" is not in the package` };
    if (!/^html?$/.test(ext(htmlPath))) return { error: `Layer "${label}": "${htmlPath}" must be an .html file` };
    const base = path.dirname(htmlPath);
    const doc = unpackDocument(textOf(files, htmlPath, warnings) || '', base, files, warnings);
    let css = doc.css;
    const cssPath = typeof l.css === 'string' ? cleanPath(l.css) : null;
    if (l.css != null && !(cssPath && doc.linked.has(cssPath))) { // a <link> to it already pulled it in
      const text = cssPath && textOf(files, cssPath, warnings);
      if (text == null) return { error: `Layer "${label}": CSS file "${l.css}" is not in the package` };
      css = `${css}\n${rewriteCss(extractFontFaces(text, path.dirname(cssPath), files, fonts, warnings), path.dirname(cssPath), resolve)}`.trim();
    }
    css = rewriteCss(extractFontFaces(css, base, files, fonts, warnings), base, resolve);
    const html = rewriteHtml(doc.html, base, resolve);
    if (!html) return { error: `Layer "${label}": the HTML has no content inside <body>` };
    const max = schema.LIMITS.maxCssLayerLength;
    if (html.length > max || css.length > max) return { error: `Layer "${label}": HTML and CSS can each be at most ${max.toLocaleString('en-US')} characters` };
    const num = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
    const w = Math.max(1, num(l.width ?? l.w, W));
    const h = Math.max(1, num(l.height ?? l.h, H));
    elements.push({ id: `css_${i + 1}`, type: 'css', name: label, x: num(l.x, 0), y: num(l.y, 0), w, h, css: css ? { html, css } : { html } });
  }

  const draft = schema.createEmptyLayout();
  draft.stage = { ...draft.stage, width: W, height: H, background: manifest.canvas.background };
  draft.elements = elements;
  return { draft, assets, fonts };
}

function designDraft(files, warnings) {
  const text = textOf(files, 'design.json', warnings);
  if (text == null) return { error: 'A "design" package needs a design.json file' };
  let draft;
  try { draft = JSON.parse(text); } catch { return { error: 'design.json is not valid JSON' }; }
  if (!isPlainObject(draft)) return { error: 'design.json is not a Designer document' };
  const assets = [];
  for (const id of schema.extractAssetIds(draft)) {
    const p = [...files.keys()].find((k) => k.startsWith(`assets/${id}.`) && IMAGE_MIME[ext(k)]);
    if (!p) { warnings.push(`Image ${id} used by the design is not in the package.`); continue; }
    if (assets.length < MAX_ASSETS) assets.push({ id, name: path.basename(p), data: files.get(p) });
  }
  return { draft, assets, fonts: [] };
}

/**
 * Zip bytes -> { pkg: { manifest, draft, assets, fonts, warnings } } or
 * { error: <message for the user> }. The draft is not validated here — the
 * caller runs it through the shared layout schema (checkDraft).
 */
function decodePackage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22 || !buf.subarray(0, 4).equals(ZIP_MAGIC)) return { error: 'This is not an overlay package (.zip)' };
  const zip = readZip(buf);
  if (zip.error) return zip;
  const files = zip.files;
  const warnings = [];

  const manifestText = textOf(files, 'overlay.json', warnings);
  if (manifestText == null) return { error: 'The package has no overlay.json at its top level' };
  let raw;
  try { raw = JSON.parse(manifestText); } catch { return { error: 'overlay.json is not valid JSON' }; }
  if (!isPlainObject(raw) || raw.format !== FORMAT) return { error: `overlay.json must contain "format": "${FORMAT}"` };
  if (raw.version != null && Number(raw.version) > PACKAGE_VERSION) return { error: 'This package was made for a newer version — update and try again' };
  const manifest = cleanManifest(raw);

  for (const p of files.keys()) {
    if (/\.(m?js|jsx|ts|wasm)$/i.test(p)) warnings.push(`"${p}" was skipped: scripts are not supported, animate with CSS.`);
  }

  const built = manifest.kind === 'design' ? designDraft(files, warnings) : htmlDraft(files, raw, manifest, warnings);
  if (built.error) return built;

  for (const f of Array.isArray(raw.fonts) ? raw.fonts : []) {
    if (!isPlainObject(f) || typeof f.family !== 'string' || typeof f.file !== 'string') { warnings.push('A font entry in overlay.json needs "family" and "file".'); continue; }
    const p = cleanPath(f.file);
    if (!p || !files.has(p)) { warnings.push(`Font file "${f.file}" is not in the package.`); continue; }
    if (ext(p) !== 'woff2') { warnings.push(`Font "${f.family}" is not a .woff2 file and was skipped.`); continue; }
    addFont(built.fonts, f.family, files.get(p));
  }
  if (manifest.kind === 'design' && isPlainObject(built.draft.stage)) {
    manifest.canvas = { width: built.draft.stage.width || 1920, height: built.draft.stage.height || 1080, background: built.draft.stage.background || null };
  }

  return { pkg: { manifest, draft: built.draft, assets: built.assets, fonts: built.fonts, warnings: [...new Set(warnings)] } };
}

/**
 * A Designer design -> a "design" package anybody can import again.
 * assets: [{ id, mime, data }], fonts: [{ family, data }].
 */
function encodePackage({ manifest, draft, assets = [], fonts = [] }) {
  const usedNames = new Set();
  const fontEntries = fonts.map((f) => {
    let base = String(f.family).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'font';
    while (usedNames.has(base)) base += '_';
    usedNames.add(base);
    return { family: f.family, file: `fonts/${base}.woff2`, data: f.data };
  });
  const out = {
    'overlay.json': strToU8(JSON.stringify({
      format: FORMAT,
      version: PACKAGE_VERSION,
      kind: 'design',
      name: manifest.name,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.author && manifest.author.name ? { author: manifest.author } : {}),
      ...(manifest.license ? { license: manifest.license } : {}),
      ...(manifest.tags && manifest.tags.length ? { tags: manifest.tags } : {}),
      canvas: manifest.canvas,
      ...(fontEntries.length ? { fonts: fontEntries.map(({ family, file }) => ({ family, file })) } : {}),
    }, null, 2)),
    'design.json': strToU8(JSON.stringify(draft)),
  };
  for (const a of assets) {
    if (!ASSET_ID_RE.test(a.id)) continue;
    out[`assets/${a.id}.${MIME_EXT[a.mime] || 'png'}`] = [new Uint8Array(a.data), { level: 0 }]; // images are already compressed
  }
  for (const f of fontEntries) out[f.file] = [new Uint8Array(f.data), { level: 0 }];
  return Buffer.from(zipSync(out, { level: 9 }));
}

/** A download file name: the design name reduced to safe characters. */
function packageFileName(name) {
  const base = String(name || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'overlay'}${FILE_EXTENSION}`;
}

module.exports = {
  decodePackage, encodePackage, packageFileName,
  FORMAT, PACKAGE_VERSION, FILE_EXTENSION, MAX_PACKAGE_BYTES, MAX_INFLATED_BYTES, MAX_ENTRIES, MAX_LAYERS,
};
