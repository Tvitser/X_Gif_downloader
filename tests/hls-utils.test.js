const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isMasterPlaylist,
  parseMasterPlaylist,
  parseMediaPlaylist,
  selectVariant
} = require("../hls-utils.js");

test("parseMasterPlaylist resolves variant URLs and selects highest bandwidth", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=64000,RESOLUTION=480x270",
    "low/stream.m3u8",
    "#EXT-X-STREAM-INF:BANDWIDTH=256000,RESOLUTION=1280x720",
    "high/stream.m3u8"
  ].join("\n");

  const baseUrl = "https://video.twimg.com/ext_tw_video/master.m3u8";
  const variants = parseMasterPlaylist(master, baseUrl);

  assert.equal(variants.length, 2);
  assert.equal(variants[0].uri, "https://video.twimg.com/ext_tw_video/low/stream.m3u8");
  assert.equal(variants[1].uri, "https://video.twimg.com/ext_tw_video/high/stream.m3u8");
  assert.equal(selectVariant(variants).uri, "https://video.twimg.com/ext_tw_video/high/stream.m3u8");
  assert.ok(isMasterPlaylist(master));
});

test("parseMediaPlaylist captures init segment and media segments in order", () => {
  const media = [
    "#EXTM3U",
    "#EXT-X-MAP:URI=\"init.mp4\"",
    "#EXTINF:2.0,",
    "segment-00001.m4s",
    "#EXTINF:2.0,",
    "segment-00002.m4s"
  ].join("\n");

  const baseUrl = "https://video.twimg.com/ext_tw_video/stream/playlist.m3u8";
  const parsed = parseMediaPlaylist(media, baseUrl);

  assert.equal(parsed.initSegmentUrl, "https://video.twimg.com/ext_tw_video/stream/init.mp4");
  assert.deepEqual(parsed.segmentUrls, [
    "https://video.twimg.com/ext_tw_video/stream/segment-00001.m4s",
    "https://video.twimg.com/ext_tw_video/stream/segment-00002.m4s"
  ]);
});
