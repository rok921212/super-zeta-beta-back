// The `.sstheme` file: one or more Designer layouts (plus the uploaded fonts
// they use) packed for another account to import as a custom theme.
//
//   bytes 0-3  'SSTH'
//   byte  4    format version (1)
//   rest       gzip of minified JSON:
//     { v, name, schemaVersion,
//       layouts: [{ name, viewKey|null, matchMode, assetBase, draft }],
//       fonts:   [{ family, data: <base64 woff2> }] }
//
// Nothing account-bound is in the file: no owner / layout / public ids, no
// revisions, no tournament or round defaults. Images are URLs inside the draft
// and travel as-is.
//
// Pure functions only — no Express, no stores (controller/themePack.controller.js).

const zlib = require('zlib');

const MAGIC = Buffer.from('SSTH', 'latin1');
const PACK_VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1;
const FILE_EXTENSION = '.sstheme';
/** Upload limit for an import (the compressed file). */
const MAX_PACK_BYTES = 12 * 1024 * 1024;
/** Inflate limit: a small file may not expand past this (zip-bomb guard). */
const MAX_INFLATED_BYTES = 40 * 1024 * 1024;
const MAX_PACK_LAYOUTS = 40;
const MAX_PACK_FONTS = 30;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** { name, schemaVersion, layouts, fonts: [{ family, data: Buffer }] } -> file bytes. */
function encodePack({ name, schemaVersion, layouts, fonts = [] }) {
  const json = JSON.stringify({
    v: PACK_VERSION,
    name,
    schemaVersion,
    layouts,
    fonts: fonts.map((f) => ({ family: f.family, data: Buffer.from(f.data).toString('base64') })),
  });
  return Buffer.concat([MAGIC, Buffer.from([PACK_VERSION]), zlib.gzipSync(json, { level: 9 })]);
}

/**
 * File bytes -> { pack } (fonts decoded to Buffers) or { error: <message for the user> }.
 * Checks the container and the shape only; drafts are validated by the caller
 * with the shared layout schema.
 */
function decodePack(buf) {
  const notAPack = { error: `This is not a ScoreSync theme file (${FILE_EXTENSION})` };
  if (!Buffer.isBuffer(buf) || buf.length <= HEADER_BYTES) return notAPack;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return notAPack;
  if (buf[MAGIC.length] !== PACK_VERSION) return { error: 'This theme file was made by a newer version — update and try again' };

  let raw;
  try {
    raw = JSON.parse(zlib.gunzipSync(buf.subarray(HEADER_BYTES), { maxOutputLength: MAX_INFLATED_BYTES }).toString('utf8'));
  } catch (err) {
    if (err && err.code === 'ERR_BUFFER_TOO_LARGE') return { error: 'Theme file is too large' };
    return { error: 'Theme file is damaged or incomplete' };
  }
  if (!isPlainObject(raw) || !Array.isArray(raw.layouts) || !raw.layouts.length) return { error: 'Theme file has no layouts' };
  if (raw.layouts.length > MAX_PACK_LAYOUTS) return { error: `Theme file has more than ${MAX_PACK_LAYOUTS} layouts` };
  const rawFonts = raw.fonts === undefined ? [] : raw.fonts;
  if (!Array.isArray(rawFonts) || rawFonts.length > MAX_PACK_FONTS) return { error: 'Theme file is damaged or incomplete' };

  const layouts = [];
  for (const l of raw.layouts) {
    if (!isPlainObject(l) || !isPlainObject(l.draft)) return { error: 'Theme file is damaged or incomplete' };
    layouts.push({
      name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().slice(0, 120) : 'Imported overlay',
      viewKey: typeof l.viewKey === 'string' ? l.viewKey : null,
      matchMode: typeof l.matchMode === 'string' ? l.matchMode : null,
      assetBase: typeof l.assetBase === 'string' ? l.assetBase : '',
      draft: l.draft,
    });
  }
  const fonts = [];
  for (const f of rawFonts) {
    if (!isPlainObject(f) || typeof f.family !== 'string' || typeof f.data !== 'string') return { error: 'Theme file is damaged or incomplete' };
    fonts.push({ family: f.family.trim().replace(/\s+/g, ' '), data: Buffer.from(f.data, 'base64') });
  }
  return {
    pack: {
      name: typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '',
      schemaVersion: raw.schemaVersion,
      layouts,
      fonts,
    },
  };
}

/**
 * Lower-cased family names a draft refers to: every name in every `*Family`
 * string (text `fontFamily`, the document theme's `fontFamily` / `headingFamily`).
 */
function usedFamilies(draft, into = new Set()) {
  const walk = (v) => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isPlainObject(v)) return;
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'string') {
        if (/family$/i.test(k)) {
          for (const part of x.split(',')) {
            const name = part.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
            if (name) into.add(name);
          }
        }
      } else walk(x);
    }
  };
  walk(draft);
  return into;
}

/** A download file name: the pack name reduced to safe characters. */
function packFileName(name) {
  const base = String(name || '').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'theme'}${FILE_EXTENSION}`;
}

module.exports = {
  encodePack, decodePack, usedFamilies, packFileName,
  PACK_VERSION, FILE_EXTENSION, MAX_PACK_BYTES, MAX_INFLATED_BYTES, MAX_PACK_LAYOUTS, MAX_PACK_FONTS,
};
