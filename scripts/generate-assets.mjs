import { createWriteStream } from 'fs';
import { deflateSync } from 'zlib';

function createPNG(width, height, pixels) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines: filter byte + RGB per pixel
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixels(x, y, width, height);
      const i = y * (1 + width * 3) + 1 + x * 3;
      raw[i] = r; raw[i+1] = g; raw[i+2] = b;
    }
  }

  const compressed = deflateSync(raw);

  function chunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 'ascii');
    data.copy(buf, 8);
    // CRC32
    const crcData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    buf.writeUInt32BE(crc32(crcData), 8 + data.length);
    return buf;
  }

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Blue brand color: #2563EB = 37,99,235
// Dark blue: #1e40af = 30,64,175
function brandBg(x, y, w, h) {
  // Simple gradient: top-left darker, bottom-right lighter
  const t = x / w;
  const r = Math.round(30 + t * (59 - 30));
  const g = Math.round(64 + t * (130 - 64));
  const b = Math.round(175 + t * (246 - 175));
  return [r, g, b];
}

// favicon 32x32
const fav32 = createPNG(32, 32, (x, y, w, h) => brandBg(x, y, w, h));
createWriteStream('public/favicon.png').end(fav32);

// apple-touch-icon 180x180
const touch = createPNG(180, 180, (x, y, w, h) => brandBg(x, y, w, h));
createWriteStream('public/apple-touch-icon.png').end(touch);

// og-image 1200x630
const og = createPNG(1200, 630, (x, y, w, h) => {
  // Background gradient blue
  const [r, g, b] = brandBg(x, y, w, h);
  return [r, g, b];
});
createWriteStream('public/og-image.png').end(og);

console.log('Generated: favicon.png, apple-touch-icon.png, og-image.png');
