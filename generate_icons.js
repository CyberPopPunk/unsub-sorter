const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Generate PNG buffer without external dependencies
function createPNG(size, primaryColor, badgeColor) {
  const width = size;
  const height = size;
  const buffer = Buffer.alloc(height * (1 + width * 4));

  const r1 = primaryColor[0], g1 = primaryColor[1], b1 = primaryColor[2];
  const r2 = badgeColor[0], g2 = badgeColor[1], b2 = badgeColor[2];

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    buffer[rowOffset] = 0;

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;

      const margin = Math.round(size * 0.12);
      const isInsideMail = (x >= margin && x < width - margin && y >= margin && y < height - margin);

      const badgeCenterX = Math.round(size * 0.75);
      const badgeCenterY = Math.round(size * 0.3);
      const badgeRadius = Math.round(size * 0.22);
      const distToBadge = Math.hypot(x - badgeCenterX, y - badgeCenterY);

      if (distToBadge <= badgeRadius) {
        buffer[pixelOffset] = r2;
        buffer[pixelOffset + 1] = g2;
        buffer[pixelOffset + 2] = b2;
        buffer[pixelOffset + 3] = 255;
      } else if (isInsideMail) {
        const isBorder = (x === margin || x === width - margin - 1 || y === margin || y === height - margin - 1);
        const flapY = Math.round(margin + (Math.abs(x - (width / 2)) * 0.7));
        const isFlap = Math.abs(y - flapY) <= 1 && y <= height * 0.55;

        if (isBorder || isFlap) {
          buffer[pixelOffset] = Math.max(0, r1 - 40);
          buffer[pixelOffset + 1] = Math.max(0, g1 - 40);
          buffer[pixelOffset + 2] = Math.max(0, b1 - 40);
          buffer[pixelOffset + 3] = 255;
        } else {
          buffer[pixelOffset] = r1;
          buffer[pixelOffset + 1] = g1;
          buffer[pixelOffset + 2] = b1;
          buffer[pixelOffset + 3] = 255;
        }
      } else {
        buffer[pixelOffset] = 0;
        buffer[pixelOffset + 1] = 0;
        buffer[pixelOffset + 2] = 0;
        buffer[pixelOffset + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(buffer);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);

    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);

    const fullBuf = Buffer.concat([typeBuf, data]);
    const crc = calcCRC(fullBuf);
    crcBuf.writeUInt32BE(crc, 0);

    return Buffer.concat([len, fullBuf, crcBuf]);
  }

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }

  function calcCRC(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

const primaryColor = [52, 109, 219];
const badgeColor = [235, 59, 90];

fs.writeFileSync(path.join(iconsDir, 'icon32.png'), createPNG(32, primaryColor, badgeColor));
fs.writeFileSync(path.join(iconsDir, 'icon64.png'), createPNG(64, primaryColor, badgeColor));
fs.writeFileSync(path.join(iconsDir, 'icon128.png'), createPNG(128, primaryColor, badgeColor));

console.log('Icons generated successfully.');
