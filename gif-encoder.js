(function createXGifEncoder(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.XGifEncoder = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function buildApi() {
  const WEB_SAFE_LEVELS = [0, 51, 102, 153, 204, 255];
  const MAX_FRAME_DELAY_CS = 6000;
  const FRAME_RENDER_TIMEOUT_MS = 250;
  let cachedPalette;

  function getPalette() {
    if (cachedPalette) {
      return cachedPalette;
    }

    const palette = [];

    for (let blue = 0; blue < WEB_SAFE_LEVELS.length; blue += 1) {
      for (let green = 0; green < WEB_SAFE_LEVELS.length; green += 1) {
        for (let red = 0; red < WEB_SAFE_LEVELS.length; red += 1) {
          palette.push(
            WEB_SAFE_LEVELS[red],
            WEB_SAFE_LEVELS[green],
            WEB_SAFE_LEVELS[blue]
          );
        }
      }
    }

    for (let index = 0; index < 40; index += 1) {
      const value = Math.round((255 * index) / 39);
      palette.push(value, value, value);
    }

    cachedPalette = Uint8Array.from(palette);
    return cachedPalette;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundToWebSafeIndex(channel) {
    return clamp(Math.round(channel / 51), 0, 5);
  }

  function rgbaToPaletteIndex(red, green, blue) {
    const redLevel = roundToWebSafeIndex(red);
    const greenLevel = roundToWebSafeIndex(green);
    const blueLevel = roundToWebSafeIndex(blue);

    const webSafeRed = WEB_SAFE_LEVELS[redLevel];
    const webSafeGreen = WEB_SAFE_LEVELS[greenLevel];
    const webSafeBlue = WEB_SAFE_LEVELS[blueLevel];
    const webSafeDistance =
      (red - webSafeRed) ** 2 +
      (green - webSafeGreen) ** 2 +
      (blue - webSafeBlue) ** 2;

    const grayscaleValue = Math.round((red + green + blue) / 3);
    const grayscaleLevel = clamp(Math.round((grayscaleValue / 255) * 39), 0, 39);
    const mappedGray = Math.round((255 * grayscaleLevel) / 39);
    const grayscaleDistance =
      (red - mappedGray) ** 2 +
      (green - mappedGray) ** 2 +
      (blue - mappedGray) ** 2;

    if (grayscaleDistance < webSafeDistance) {
      return 216 + grayscaleLevel;
    }

    return redLevel + greenLevel * 6 + blueLevel * 36;
  }

  function indexPixels(rgbaPixels) {
    const indexedPixels = new Uint8Array(rgbaPixels.length / 4);

    for (let offset = 0, pixelIndex = 0; offset < rgbaPixels.length; offset += 4, pixelIndex += 1) {
      indexedPixels[pixelIndex] = rgbaToPaletteIndex(
        rgbaPixels[offset],
        rgbaPixels[offset + 1],
        rgbaPixels[offset + 2]
      );
    }

    return indexedPixels;
  }

  function packLzwCodes(codes) {
    const packedBytes = [];
    let current = 0;
    let bitCount = 0;

    for (const { code, size } of codes) {
      current |= code << bitCount;
      bitCount += size;

      while (bitCount >= 8) {
        packedBytes.push(current & 0xff);
        current >>= 8;
        bitCount -= 8;
      }
    }

    if (bitCount > 0) {
      packedBytes.push(current & 0xff);
    }

    return packedBytes;
  }

  function lzwEncode(indexedPixels, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    let dictionary;
    let nextCode;
    let codeSize;

    function resetDictionary() {
      dictionary = new Map();
      nextCode = endCode + 1;
      codeSize = minCodeSize + 1;
    }

    function sequenceCode(sequence) {
      if (sequence.indexOf(",") === -1) {
        return Number(sequence);
      }

      return dictionary.get(sequence);
    }

    const codes = [];
    resetDictionary();
    codes.push({ code: clearCode, size: codeSize });

    if (indexedPixels.length === 0) {
      codes.push({ code: endCode, size: codeSize });
      return packLzwCodes(codes);
    }

    let prefix = String(indexedPixels[0]);

    for (let offset = 1; offset < indexedPixels.length; offset += 1) {
      const suffix = indexedPixels[offset];
      const candidate = `${prefix},${suffix}`;

      if (dictionary.has(candidate)) {
        prefix = candidate;
        continue;
      }

      codes.push({ code: sequenceCode(prefix), size: codeSize });

      if (nextCode < 4096) {
        dictionary.set(candidate, nextCode);
        nextCode += 1;

        if (nextCode === 1 << codeSize && codeSize < 12) {
          codeSize += 1;
        }
      } else {
        codes.push({ code: clearCode, size: codeSize });
        resetDictionary();
      }

      prefix = String(suffix);
    }

    codes.push({ code: sequenceCode(prefix), size: codeSize });
    codes.push({ code: endCode, size: codeSize });

    return packLzwCodes(codes);
  }

  function writeSubBlocks(byteArray, data) {
    for (let offset = 0; offset < data.length; offset += 255) {
      const chunk = data.slice(offset, offset + 255);
      byteArray.push(chunk.length, ...chunk);
    }

    byteArray.push(0x00);
  }

  function encodeGif({ width, height, frames, loopCount = 0, delayCs = 10 }) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error("GIF dimensions must be positive integers.");
    }

    if (!Array.isArray(frames) || frames.length === 0) {
      throw new Error("At least one GIF frame is required.");
    }

    const bytes = [];
    const palette = getPalette();
    const minimumCodeSize = 8;

    function pushString(value) {
      for (let index = 0; index < value.length; index += 1) {
        bytes.push(value.charCodeAt(index));
      }
    }

    function pushShort(value) {
      bytes.push(value & 0xff, (value >> 8) & 0xff);
    }

    pushString("GIF89a");
    pushShort(width);
    pushShort(height);
    bytes.push(0xf7, 0x00, 0x00);
    bytes.push(...palette);

    pushString("!\xff\u000bNETSCAPE2.0");
    bytes.push(0x03, 0x01);
    pushShort(loopCount);
    bytes.push(0x00);

    for (const frame of frames) {
      if (!frame || !frame.pixels || frame.pixels.length !== width * height * 4) {
        throw new Error("Each frame must provide RGBA pixels for the configured GIF dimensions.");
      }

      const indexedPixels = indexPixels(frame.pixels);
      const encodedImageData = lzwEncode(indexedPixels, minimumCodeSize);
      const frameDelay = clamp(Math.round(frame.delayCs ?? delayCs), 2, MAX_FRAME_DELAY_CS);

      bytes.push(0x21, 0xf9, 0x04, 0x00);
      pushShort(frameDelay);
      bytes.push(0x00, 0x00);

      bytes.push(0x2c);
      pushShort(0);
      pushShort(0);
      pushShort(width);
      pushShort(height);
      bytes.push(0x00);
      bytes.push(minimumCodeSize);
      writeSubBlocks(bytes, encodedImageData);
    }

    bytes.push(0x3b);
    return Uint8Array.from(bytes);
  }

  function waitForEvent(target, successEvent, errorEvent) {
    return new Promise((resolve, reject) => {
      function cleanup() {
        target.removeEventListener(successEvent, handleSuccess);
        if (errorEvent) {
          target.removeEventListener(errorEvent, handleError);
        }
      }

      function handleSuccess() {
        cleanup();
        resolve();
      }

      function handleError() {
        cleanup();
        reject(new Error(`Failed while waiting for ${successEvent}.`));
      }

      target.addEventListener(successEvent, handleSuccess, { once: true });

      if (errorEvent) {
        target.addEventListener(errorEvent, handleError, { once: true });
      }
    });
  }

  async function waitForLoadedFrame(video) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    await waitForEvent(video, "loadeddata", "error");
  }

  async function waitForRenderedFrame(video) {
    async function waitForNextPaint() {
      await new Promise((resolve) => {
        // Older browsers do not expose frame-level callbacks for paused/seeked video.
        // Falling back to the next paint avoids hanging conversion, even though it cannot
        // guarantee the same frame accuracy as requestVideoFrameCallback.
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
          return;
        }

        setTimeout(resolve, 0);
      });
    }

    if (typeof video.requestVideoFrameCallback === "function") {
      const renderState = await new Promise((resolve, reject) => {
        let settled = false;
        let callbackId = null;
        const timeoutId = setTimeout(handleTimeout, FRAME_RENDER_TIMEOUT_MS);

        function cleanup() {
          if (typeof video.cancelVideoFrameCallback === "function" && callbackId !== null) {
            video.cancelVideoFrameCallback(callbackId);
          }
          clearTimeout(timeoutId);
          video.removeEventListener("error", handleError);
        }

        function finish() {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve("frame");
        }

        function handleError() {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          reject(new Error("Failed while waiting for a rendered video frame."));
        }

        function handleTimeout() {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve("timeout");
        }

        video.addEventListener("error", handleError, { once: true });
        callbackId = video.requestVideoFrameCallback(() => finish());
      });

      if (renderState === "frame") {
        return;
      }

      await waitForNextPaint();
    }

    await waitForNextPaint();
  }

  async function seekVideo(video, timeInSeconds) {
    if (Math.abs(video.currentTime - timeInSeconds) >= 0.001) {
      const seeked = waitForEvent(video, "seeked", "error");
      video.currentTime = timeInSeconds;
      await seeked;
    }

    await waitForLoadedFrame(video);
    await waitForRenderedFrame(video);
  }

  async function convertVideoBlobToGifBlob(blob, options = {}) {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      throw new Error("Video conversion is only available in a browser context.");
    }

    const fps = clamp(Number(options.fps) || 10, 1, 20);
    const maxDuration = clamp(Number(options.maxDuration) || 8, 1, 15);
    const maxDimension = clamp(Number(options.maxDimension) || 320, 64, 512);
    const sourceUrl = URL.createObjectURL(blob);
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    try {
      const metadataReady = waitForEvent(video, "loadedmetadata", "error");
      video.src = sourceUrl;
      video.load();
      await metadataReady;
      await waitForLoadedFrame(video);

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;

      if (!sourceWidth || !sourceHeight) {
        throw new Error("The selected MP4 does not expose valid video dimensions.");
      }

      const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const duration = Math.min(
        maxDuration,
        Number.isFinite(video.duration) && video.duration > 0 ? video.duration : maxDuration
      );
      const totalFrames = Math.max(1, Math.min(80, Math.ceil(duration * fps)));
      const frameDelayCs = Math.max(2, Math.round((duration * 100) / totalFrames));

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        throw new Error("Unable to create a canvas context for GIF conversion.");
      }

      const frames = [];

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        const nextTime = Math.min(
          Math.max(duration - 0.001, 0),
          (frameIndex / totalFrames) * duration
        );

        await seekVideo(video, nextTime);
        context.drawImage(video, 0, 0, width, height);
        frames.push({
          pixels: context.getImageData(0, 0, width, height).data,
          delayCs: frameDelayCs
        });
      }

      return new Blob([encodeGif({ width, height, frames, delayCs: frameDelayCs })], {
        type: "image/gif"
      });
    } finally {
      URL.revokeObjectURL(sourceUrl);
      video.removeAttribute("src");
      video.load();
    }
  }

  async function convertVideoUrlToGifBlob(videoUrl, options) {
    const response = await fetch(videoUrl);

    if (!response.ok) {
      throw new Error(`Unable to download the MP4 source (${response.status}).`);
    }

    return convertVideoBlobToGifBlob(await response.blob(), options);
  }

  return {
    convertVideoBlobToGifBlob,
    convertVideoUrlToGifBlob,
    encodeGif,
    getPalette,
    rgbaToPaletteIndex
  };
});
