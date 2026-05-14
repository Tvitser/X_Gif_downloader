const test = require("node:test");
const assert = require("node:assert/strict");

const { encodeGif, getPalette, rgbaToPaletteIndex } = require("../gif-encoder.js");

function readSubBlocks(bytes, offset) {
  const output = [];

  while (true) {
    const length = bytes[offset];
    offset += 1;

    if (length === 0) {
      break;
    }

    output.push(...bytes.subarray(offset, offset + length));
    offset += length;
  }

  return {
    data: Uint8Array.from(output),
    offset
  };
}

function decodeLzw(data, minimumCodeSize, pixelCount) {
  const clearCode = 1 << minimumCodeSize;
  const endCode = clearCode + 1;
  let bitOffset = 0;
  let dictionary;
  let nextCode;
  let codeSize;
  let previousEntry = null;
  const pixels = [];

  function readCode(size) {
    let code = 0;

    for (let index = 0; index < size; index += 1) {
      const absoluteBit = bitOffset + index;
      const byteIndex = Math.floor(absoluteBit / 8);
      const bitIndex = absoluteBit % 8;
      code |= ((data[byteIndex] >> bitIndex) & 1) << index;
    }

    bitOffset += size;
    return code;
  }

  function resetDictionary() {
    dictionary = [];

    for (let index = 0; index < clearCode; index += 1) {
      dictionary[index] = [index];
    }

    dictionary[clearCode] = null;
    dictionary[endCode] = null;
    nextCode = endCode + 1;
    codeSize = minimumCodeSize + 1;
  }

  resetDictionary();

  while (pixels.length < pixelCount) {
    const code = readCode(codeSize);

    if (code === clearCode) {
      resetDictionary();
      previousEntry = null;
      continue;
    }

    if (code === endCode) {
      break;
    }

    const entry =
      dictionary[code] ||
      (code === nextCode && previousEntry ? previousEntry.concat(previousEntry[0]) : null);

    assert.ok(entry, `Expected LZW entry for code ${code}.`);

    pixels.push(...entry);

    if (previousEntry) {
      dictionary[nextCode] = previousEntry.concat(entry[0]);
      nextCode += 1;

      if (nextCode === 1 << codeSize && codeSize < 12) {
        codeSize += 1;
      }
    }

    previousEntry = entry;
  }

  return pixels.slice(0, pixelCount);
}

function decodeGifFrames(gifBytes) {
  const width = gifBytes[6] | (gifBytes[7] << 8);
  const height = gifBytes[8] | (gifBytes[9] << 8);
  const frames = [];
  let offset = 13 + 256 * 3;

  assert.equal(Buffer.from(gifBytes.subarray(0, 6)).toString("ascii"), "GIF89a");

  while (offset < gifBytes.length) {
    const introducer = gifBytes[offset];

    if (introducer === 0x3b) {
      break;
    }

    if (introducer === 0x21) {
      const label = gifBytes[offset + 1];

      if (label === 0xf9) {
        const delayCs = gifBytes[offset + 4] | (gifBytes[offset + 5] << 8);
        offset += 8;
        assert.equal(gifBytes[offset], 0x2c);
        offset += 10;
        const minimumCodeSize = gifBytes[offset];
        offset += 1;
        const { data, offset: nextOffset } = readSubBlocks(gifBytes, offset);

        frames.push({
          delayCs,
          pixels: decodeLzw(data, minimumCodeSize, width * height)
        });
        offset = nextOffset;
        continue;
      }

      if (label === 0xff) {
        const blockSize = gifBytes[offset + 2];
        offset += 3 + blockSize;
        ({ offset } = readSubBlocks(gifBytes, offset));
        continue;
      }
    }

    throw new Error(`Unexpected GIF block at offset ${offset}.`);
  }

  return { width, height, frames };
}

test("palette mapping preserves exact web-safe colors", () => {
  const palette = getPalette();
  const index = rgbaToPaletteIndex(255, 0, 0);
  const colorOffset = index * 3;

  assert.deepEqual(Array.from(palette.slice(colorOffset, colorOffset + 3)), [255, 0, 0]);
});

test("encodeGif emits a valid GIF89a container", () => {
  const redBlueFrame = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 0, 255, 255
  ]);
  const blueRedFrame = new Uint8ClampedArray([
    0, 0, 255, 255,
    255, 0, 0, 255
  ]);

  const gifBytes = encodeGif({
    width: 2,
    height: 1,
    frames: [
      { pixels: redBlueFrame, delayCs: 5 },
      { pixels: blueRedFrame, delayCs: 5 }
    ]
  });

  assert.equal(Buffer.from(gifBytes.subarray(0, 6)).toString("ascii"), "GIF89a");
  assert.equal(gifBytes[6] | (gifBytes[7] << 8), 2);
  assert.equal(gifBytes[8] | (gifBytes[9] << 8), 1);
  assert.equal(gifBytes[gifBytes.length - 1], 0x3b);
  assert.ok(Buffer.from(gifBytes).includes(Buffer.from("NETSCAPE2.0", "ascii")));
});

test("encodeGif preserves frame pixels when decoded", () => {
  const red = rgbaToPaletteIndex(255, 0, 0);
  const green = rgbaToPaletteIndex(0, 255, 0);
  const blue = rgbaToPaletteIndex(0, 0, 255);
  const white = rgbaToPaletteIndex(255, 255, 255);
  const frameA = new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255
  ]);
  const frameB = new Uint8ClampedArray([
    0, 0, 255, 255,
    255, 255, 255, 255,
    255, 0, 0, 255,
    0, 255, 0, 255
  ]);

  const gifBytes = encodeGif({
    width: 2,
    height: 2,
    frames: [
      { pixels: frameA, delayCs: 4 },
      { pixels: frameB, delayCs: 7 }
    ]
  });
  const decoded = decodeGifFrames(gifBytes);

  assert.deepEqual(decoded, {
    width: 2,
    height: 2,
    frames: [
      { delayCs: 4, pixels: [red, green, blue, white] },
      { delayCs: 7, pixels: [blue, white, red, green] }
    ]
  });
});
