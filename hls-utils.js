(function createXHlsUtils(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.XHlsUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : self, function buildApi() {
  function normalizeLines(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function parseAttributeList(value) {
    const attributes = {};
    const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match = null;

    while ((match = regex.exec(value)) !== null) {
      const key = match[1];
      let rawValue = match[2] ?? "";

      if (rawValue.startsWith("\"") && rawValue.endsWith("\"")) {
        rawValue = rawValue.slice(1, -1);
      }

      attributes[key] = rawValue;
    }

    return attributes;
  }

  function resolveUrl(uri, baseUrl) {
    return new URL(uri, baseUrl).toString();
  }

  function isMasterPlaylist(text) {
    return normalizeLines(text).some((line) => line.startsWith("#EXT-X-STREAM-INF"));
  }

  function parseMasterPlaylist(text, baseUrl) {
    const lines = normalizeLines(text);
    const variants = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (!line.startsWith("#EXT-X-STREAM-INF")) {
        continue;
      }

      const attributeList = line.split(":", 2)[1] ?? "";
      const attributes = parseAttributeList(attributeList);
      let uri = null;

      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const nextLine = lines[nextIndex];

        if (nextLine.startsWith("#")) {
          continue;
        }

        uri = nextLine;
        index = nextIndex;
        break;
      }

      if (!uri) {
        continue;
      }

      variants.push({
        uri: resolveUrl(uri, baseUrl),
        bandwidth: Number(attributes.BANDWIDTH) || 0,
        resolution: attributes.RESOLUTION || null
      });
    }

    return variants;
  }

  function selectVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
      return null;
    }

    return variants.reduce((best, candidate) =>
      candidate.bandwidth > (best?.bandwidth ?? 0) ? candidate : best
    );
  }

  function parseMediaPlaylist(text, baseUrl) {
    const lines = normalizeLines(text);
    let initSegmentUrl = null;
    const segmentUrls = [];

    for (const line of lines) {
      if (line.startsWith("#EXT-X-MAP")) {
        const attributes = parseAttributeList(line.split(":", 2)[1] ?? "");

        if (attributes.URI) {
          initSegmentUrl = resolveUrl(attributes.URI, baseUrl);
        }

        continue;
      }

      if (line.startsWith("#")) {
        continue;
      }

      segmentUrls.push(resolveUrl(line, baseUrl));
    }

    return { initSegmentUrl, segmentUrls };
  }

  return {
    isMasterPlaylist,
    parseAttributeList,
    parseMasterPlaylist,
    parseMediaPlaylist,
    resolveUrl,
    selectVariant
  };
});
