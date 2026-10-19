/* Regenerates the PWA icons. No dependencies — writes PNGs directly.
     node scripts/make-icons.js .
*/
const zlib = require('zlib');
const fs = require('fs');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) { const p = px(x, y); raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [26, 23, 18, 255];
// three book spines, in the app's accent / thai / free hues
const SPINES = [[200, 130, 74], [120, 158, 200], [111, 191, 149]];

function draw(size, pad) {
  const inner = size * (1 - pad * 2);
  const x0 = size * pad;
  const gap = inner * 0.07;
  const w = (inner - gap * 2) / 3;
  return (x, y) => {
    for (let i = 0; i < 3; i++) {
      const left = x0 + i * (w + gap);
      // the middle book sits slightly taller, like a real shelf
      const h = inner * (i === 1 ? 1 : 0.86);
      const top = x0 + inner - h;
      if (x >= left && x < left + w && y >= top && y < x0 + inner) {
        const r = w * 0.18;
        const cx = Math.min(Math.max(x, left + r), left + w - r);
        const cy = Math.min(Math.max(y, top + r), x0 + inner - r);
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        // a lighter band near the top of each spine
        const band = y > top + h * 0.16 && y < top + h * 0.26;
        const c = SPINES[i];
        return band ? [255, 255, 255, 235] : [c[0], c[1], c[2], 255];
      }
    }
    return BG;
  };
}

for (const [name, size, pad] of [['icon-192.png', 192, 0.17], ['icon-512.png', 512, 0.17], ['icon-maskable-512.png', 512, 0.27], ['apple-touch-icon.png', 180, 0.15]]) {
  fs.writeFileSync((process.argv[2] || '.') + '/' + name, png(size, draw(size, pad)));
  console.log('wrote', name, size + 'px');
}
