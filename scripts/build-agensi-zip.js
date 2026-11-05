#!/usr/bin/env node
'use strict';
// Builds the Agensi upload: dist/global-brain-agensi-<version>.zip with SKILL.md
// at the ZIP root (no folder). Zero dependencies: a minimal ZIP writer on top of
// zlib (deflate + crc32), then the archive is read back and checked.
//   node scripts/build-agensi-zip.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// DOS date/time for the ZIP headers (taken from the SKILL.md mtime).
function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;
    const { time, date } = dosTime(f.mtime);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);        // version needed
    lh.writeUInt16LE(0x0800, 6);    // flags: UTF-8 names
    lh.writeUInt16LE(8, 8);         // deflate
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);    // made by: unix, 3.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);        // extra
    ch.writeUInt16LE(0, 32);        // comment
    ch.writeUInt16LE(0, 34);        // disk
    ch.writeUInt16LE(0, 36);        // internal attrs
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file 644
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// Read the archive back: entry names + inflated contents, CRC verified.
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central header');
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(lo + 26);
    const lelen = buf.readUInt16LE(lo + 28);
    const data = zlib.inflateRawSync(buf.slice(lo + 30 + lnlen + lelen, lo + 30 + lnlen + lelen + csize));
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`CRC mismatch for ${name}`);
    out.push({ name, data });
    p += 46 + nlen + elen + clen;
  }
  return out;
}

function buildAgensiZip() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const src = path.join(ROOT, 'agensi', 'SKILL.md');
  // LF only, whatever git's autocrlf did to the working copy.
  const data = Buffer.from(fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n'), 'utf8');
  if (!data.toString('utf8').startsWith('---\nname: global-brain\n')) {
    throw new Error('agensi/SKILL.md must start with LF frontmatter "name: global-brain"');
  }
  const buf = zip([{ name: 'SKILL.md', data, mtime: fs.statSync(src).mtime }]);
  const entries = readZip(buf);
  if (entries.length !== 1 || entries[0].name !== 'SKILL.md' || !entries[0].data.equals(data)) {
    throw new Error('ZIP self-check failed: expected exactly SKILL.md at the root');
  }
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, `global-brain-agensi-${version}.zip`);
  fs.writeFileSync(out, buf);
  return { out, version, bytes: buf.length };
}

module.exports = { buildAgensiZip, readZip, zip };

if (require.main === module) {
  try {
    const r = buildAgensiZip();
    console.log(`${path.relative(ROOT, r.out)} (${r.bytes} bytes, SKILL.md at root)`);
  } catch (e) { console.error(`build-agensi-zip: ${e.message}`); process.exit(1); }
}
