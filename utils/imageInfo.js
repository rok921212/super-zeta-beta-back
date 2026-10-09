// What an uploaded image really is, decided by its bytes (never by the file
// name or the Content-Type the client claims), plus its pixel size read from
// the file header. No image library: PNG, JPEG, WebP and SVG headers are small
// and fixed. Pure functions.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngInfo(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegInfo(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }          // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; } // no length
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpInfo(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') {
    return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (kind === 'VP8 ') {
    return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L' && buf[20] === 0x2f) {
    const bits = buf.readUInt32LE(21);
    return { mime: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

/**
 * Why an SVG may not be stored, or null when it is acceptable. The file is
 * never rewritten: anything that could run code or load something from
 * elsewhere is refused outright.
 */
function svgProblem(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return 'it has a DOCTYPE / entity declaration';
  if (/<\s*script[\s>/]/i.test(text)) return 'it contains a script';
  if (/<\s*(foreignObject|iframe|embed|object|audio|video|link|meta|style\s+[^>]*@import)/i.test(text)) return 'it embeds other content';
  if (/\son[a-z]+\s*=/i.test(text)) return 'it has event handlers (on…=)';
  if (/javascript\s*:/i.test(text)) return 'it has a javascript: link';
  if (/@import/i.test(text)) return 'its styles import another file';
  // href / xlink:href / src may only point inside the file (#id) or at an embedded picture.
  const refs = text.match(/(?:xlink:href|href|src)\s*=\s*(?:"[^"]*"|'[^']*')/gi) || [];
  for (const r of refs) {
    const v = r.replace(/^[^=]+=\s*/, '').slice(1, -1).trim();
    if (v && !/^#/.test(v) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(v)) return 'it links to an outside file';
  }
  // url(...) in styles / attributes: only url(#id).
  const urls = text.match(/url\(\s*[^)]*\)/gi) || [];
  for (const u of urls) {
    if (!/^url\(\s*["']?#[^)]*\)$/i.test(u)) return 'it loads an outside file from a style';
  }
  return null;
}

function svgInfo(buf) {
  // An SVG is text: refuse anything with a NUL or that does not open with an <svg> root.
  if (buf.includes(0)) return null;
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const head = text.slice(0, 2000).replace(/<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trimStart();
  if (!/^<svg[\s>]/i.test(head)) return null;
  const tag = (text.match(/<svg[^>]*>/i) || [''])[0];
  const attr = (name) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)(px)?\\s*["']`, 'i'));
    return m ? Math.round(Number(m[1])) : 0;
  };
  let width = attr('width');
  let height = attr('height');
  if (!width || !height) {
    const vb = tag.match(/\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i);
    if (vb) { width = Math.round(Number(vb[1])); height = Math.round(Number(vb[2])); }
  }
  return { mime: 'image/svg+xml', width: width || 0, height: height || 0, problem: svgProblem(text) };
}

/** { mime, width, height, problem? } for a supported image, else null. */
function imageInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  return pngInfo(buf) || jpegInfo(buf) || webpInfo(buf) || svgInfo(buf);
}

module.exports = { imageInfo, svgProblem };
