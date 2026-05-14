const test = require("node:test");
const assert = require("node:assert/strict");

const { encodeGif, getPalette, rgbaToPaletteIndex } = require("../gif-encoder.js");

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
