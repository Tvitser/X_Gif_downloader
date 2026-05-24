(function initializeXGifDownloader(root) {
  const LOG_PREFIX = "[X GIF Downloader]";
  const encoder = root.XGifEncoder;
  const hlsUtils = root.XHlsUtils;
  const hasGifSupport = Boolean(encoder && typeof encoder.convertVideoUrlToGifBlob === "function");
  const hasHlsSupport = Boolean(hlsUtils && typeof hlsUtils.parseMediaPlaylist === "function");

  if (!hasGifSupport && !hasHlsSupport) {
    console.warn(`${LOG_PREFIX} No supported download handlers found.`);
    return;
  }

  console.info(
    `${LOG_PREFIX} Initialized (GIF=${hasGifSupport ? "on" : "off"}, HLS=${
      hasHlsSupport ? "on" : "off"
    }).`
  );

  const BUTTON_CLASS = "xgif-download-button";
  const ACTION_ITEM_CLASS = "xgif-download-action";
  const DOWNLOAD_TYPE_ATTRIBUTE = "data-xgif-download-type";
  const GIF_PROCESSED_MARKER = "xgifDownloadGifAttached";
  const HLS_PROCESSED_MARKER = "xgifDownloadHlsAttached";
  const NO_PANEL_MARKER = "xgifDownloadNoPanel";
  const NO_SCOPE_MARKER = "xgifDownloadNoScope";
  const NO_ACTION_BUTTON_MARKER = "xgifDownloadNoActionButton";
  const NO_MEDIA_MARKER = "xgifDownloadNoMedia";
  const DEBUG_LOGGED_MARKER = "xgifDownloadDebugLogged";
  const POST_LOGGED_MARKER = "xgifDownloadPostLogged";
  const POST_NO_MEDIA_MARKER = "xgifDownloadPostNoMedia";
  const POST_HAS_MEDIA_MARKER = "xgifDownloadPostHasMedia";
  const MEDIA_CANDIDATES_MARKER = "xgifDownloadMediaCandidatesLogged";
  const BLOB_PENDING_MARKER = "xgifDownloadBlobPending";
  const ACTION_PANEL_TEST_ID_SELECTORS = [
    '[data-testid="reply"]',
    '[data-testid="comment"]',
    '[data-testid="retweet"]',
    '[data-testid="repost"]',
    '[data-testid="unretweet"]',
    '[data-testid="unrepost"]',
    '[data-testid="like"]',
    '[data-testid="unlike"]',
    '[data-testid="bookmark"]',
    '[data-testid="unbookmark"]',
    '[data-testid="share"]'
  ];
  const ACTION_PANEL_ARIA_SELECTORS = [
    '[aria-label*="Reply"]',
    '[aria-label*="Repost"]',
    '[aria-label*="Retweet"]',
    '[aria-label*="Like"]',
    '[aria-label*="Bookmark"]',
    '[aria-label*="Share"]'
  ];
  const ACTION_PANEL_SELECTOR = [
    ...ACTION_PANEL_TEST_ID_SELECTORS,
    ...ACTION_PANEL_ARIA_SELECTORS
  ].join(", ");
  const SHARE_ACTION_SELECTOR = '[data-testid="share"]';
  const POST_SELECTOR = [
    '[data-testid="tweet"]',
    '[data-testid="tweetDetail"]',
    '[data-testid="cellInnerDiv"]',
    '[role="article"]',
    "article"
  ].join(", ");
  let loggedEmptyScan = false;

  function logOnce(target, marker, logger, message, ...details) {
    if (!target || !(target instanceof Element)) {
      return;
    }

    if (target.dataset[marker]) {
      return;
    }

    target.dataset[marker] = "true";
    logger(`${LOG_PREFIX} ${message}`, ...details);
  }

  function normalizeUrl(url) {
    if (typeof url !== "string") {
      return null;
    }

    const sanitized = url.replace(/&amp;/g, "&");

    try {
      return new URL(sanitized, window.location.href).toString();
    } catch (error) {
      return null;
    }
  }

  function extractTweetIdFromUrl(url) {
    if (typeof url !== "string") {
      return null;
    }

    const match =
      url.match(/\/(?:amplify_video|ext_tw_video|tweet_video|video)\/(\d{5,})/i) ||
      url.match(/\/status\/(\d{5,})/i);

    return match?.[1] ?? null;
  }

  function getTweetId(scope) {
    if (!scope) {
      return null;
    }

    const anchors = scope.querySelectorAll?.('a[href*="/status/"]') ?? [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href") || anchor.href || "";
      const tweetId = extractTweetIdFromUrl(href);

      if (tweetId) {
        return tweetId;
      }
    }

    return null;
  }

  function getPostScope(video) {
    return (
      video.closest('[data-testid="tweet"]') ||
      video.closest('[data-testid="tweetDetail"]') ||
      video.closest('[role="article"]') ||
      video.closest("article") ||
      video.closest('[data-testid="cellInnerDiv"]') ||
      video.parentElement
    );
  }

  const networkMediaByTweetId = new Map();
  let rescanScheduled = false;

  function scheduleRescan() {
    if (rescanScheduled) {
      return;
    }

    rescanScheduled = true;
    const callback = () => {
      rescanScheduled = false;
      installNetworkSniffer();
      scan();
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback, { timeout: 1000 });
    } else {
      setTimeout(callback, 500);
    }
  }

  function scoreM3u8Url(url) {
    if (typeof url !== "string") {
      return 0;
    }

    let score = 0;

    if (url.includes("/pl/")) {
      score += 3;
    }

    if (url.includes("master.m3u8")) {
      score += 2;
    }

    if (url.includes("variant_version")) {
      score += 1;
    }

    return score;
  }

  function selectNetworkM3u8Url(tweetId) {
    const entry = networkMediaByTweetId.get(tweetId);

    if (!entry || entry.m3u8Urls.size === 0) {
      return null;
    }

    return Array.from(entry.m3u8Urls).sort((a, b) => scoreM3u8Url(b) - scoreM3u8Url(a))[0];
  }

  function recordNetworkMedia(url) {
    const normalized = normalizeUrl(url);

    if (!normalized) {
      return;
    }

    const lower = normalized.toLowerCase();

    if (!lower.includes(".m3u8") && !lower.includes(".m4s")) {
      return;
    }

    const tweetId = extractTweetIdFromUrl(normalized);

    if (!tweetId) {
      return;
    }

    let entry = networkMediaByTweetId.get(tweetId);

    if (!entry) {
      entry = { m3u8Urls: new Set(), m4sUrls: new Set() };
      networkMediaByTweetId.set(tweetId, entry);
    }

    const targetSet = lower.includes(".m3u8") ? entry.m3u8Urls : entry.m4sUrls;
    const beforeSize = targetSet.size;
    targetSet.add(normalized);

    if (targetSet.size !== beforeSize) {
      scheduleRescan();
    }
  }

  function installNetworkSniffer() {
    window.addEventListener("message", (event) => {
      if (event.source !== window) {
        return;
      }

      const payload = event.data;

      if (!payload || payload.source !== "xgif-network") {
        return;
      }

      recordNetworkMedia(payload.url);
    });

    try {
      performance
        .getEntriesByType("resource")
        .forEach((entry) => recordNetworkMedia(entry.name));
    } catch (error) {
      // ignore
    }

    const script = document.createElement("script");
    script.textContent = `(() => {
      if (window.__xgifNetworkSnifferInstalled) return;
      window.__xgifNetworkSnifferInstalled = true;
      const send = (url) => {
        try {
          window.postMessage({ source: "xgif-network", url }, "*");
        } catch (e) {}
      };
      const record = (input) => {
        if (!input) return;
        try {
          const url = typeof input === "string" ? input : input.url;
          if (url) send(url);
        } catch (e) {}
      };
      const originalFetch = window.fetch;
      if (typeof originalFetch === "function") {
        window.fetch = function(...args) {
          record(args[0]);
          return originalFetch.apply(this, args);
        };
      }
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        record(url);
        return originalOpen.call(this, method, url, ...rest);
      };
      if (window.PerformanceObserver) {
        try {
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              send(entry.name);
            }
          });
          observer.observe({ type: "resource", buffered: true });
        } catch (e) {}
      }
    })();`;
    document.documentElement.appendChild(script);
    script.remove();
  }

  function hasGifBadge(video) {
    const scope = getPostScope(video);

    if (!scope) {
      return false;
    }

    if (scope.querySelector('[data-testid="gif"]')) {
      return true;
    }

    const label = video.getAttribute("aria-label") || "";

    if (label.toUpperCase().includes("GIF")) {
      return true;
    }

    return Array.from(scope.querySelectorAll("span")).some((span) => span.textContent?.trim() === "GIF");
  }

  function collectMediaUrls(video, scope) {
    const urls = new Set();
    const blobUrls = new Set();

    const addUrl = (value) => {
      if (typeof value !== "string") {
        return;
      }

      const trimmed = value.trim();

      if (!trimmed) {
        return;
      }

      if (trimmed.startsWith("blob:")) {
        blobUrls.add(trimmed);
      } else {
        urls.add(trimmed);
      }
    };

    if (video) {
      addUrl(video.currentSrc);
      addUrl(video.src);
      addUrl(video.getAttribute("src"));
      addUrl(video.getAttribute("data-src"));
      addUrl(video.getAttribute("data-url"));
      video.querySelectorAll("source").forEach((source) => {
        addUrl(source.src);
        addUrl(source.getAttribute("src"));
        addUrl(source.getAttribute("data-src"));
        addUrl(source.getAttribute("data-url"));
      });
    }

    const scopeRoot = scope || video?.parentElement;

    if (scopeRoot) {
      scopeRoot.querySelectorAll("[src], [href], [data-src], [data-url]").forEach((element) => {
        addUrl(element.getAttribute("src"));
        addUrl(element.getAttribute("href"));
        addUrl(element.getAttribute("data-src"));
        addUrl(element.getAttribute("data-url"));
      });
    }

    return { httpUrls: Array.from(urls), blobUrls: Array.from(blobUrls) };
  }

  function findMp4Url(sourceUrls) {
    return sourceUrls.find(
      (url) => typeof url === "string" && /^https?:/.test(url) && url.toLowerCase().includes(".mp4")
    );
  }

  function findM3u8Url(sourceUrls) {
    const m3u8Url = sourceUrls.find(
      (url) =>
        typeof url === "string" && /^https?:/.test(url) && url.toLowerCase().includes(".m3u8")
    );

    return normalizeUrl(m3u8Url);
  }

  function getMp4Url(video, scope) {
    const { httpUrls } = collectMediaUrls(video, scope);
    return findMp4Url(httpUrls);
  }

  function getM3u8Url(video, scope) {
    const { httpUrls } = collectMediaUrls(video, scope);
    return findM3u8Url(httpUrls);
  }

  function isActionPanel(group) {
    return Boolean(group.querySelector(ACTION_PANEL_SELECTOR));
  }

  function findActionPanelFromButton(actionButton) {
    let node = actionButton.parentElement;

    while (node && node !== document.body) {
      if (node.querySelectorAll(ACTION_PANEL_SELECTOR).length >= 2) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function findActionButton(startNode) {
    let node = startNode;

    while (node && node !== document.body) {
      if (node.querySelector) {
        const actionButton = node.querySelector(ACTION_PANEL_SELECTOR);

        if (actionButton) {
          return actionButton;
        }
      }

      node = node.parentElement;
    }

    return null;
  }

  function getActionPanel(video, scope = getPostScope(video)) {
    if (!scope) {
      logOnce(video, NO_SCOPE_MARKER, console.debug, "Post scope not found for video.", video);
      return null;
    }

    const actionButton = findActionButton(scope);

    if (!actionButton) {
      logOnce(video, NO_ACTION_BUTTON_MARKER, console.debug, "Action button not found for video.", scope);
      return null;
    }

    const actionPanel =
      actionButton.closest('[role="group"]') ||
      Array.from(scope.querySelectorAll('[role="group"]')).find(isActionPanel) ||
      findActionPanelFromButton(actionButton) ||
      actionButton.parentElement;

    if (!actionPanel) {
      logOnce(video, NO_PANEL_MARKER, console.debug, "Action panel not found for video.", {
        video,
        scope,
        actionButton
      });
      return null;
    }

    return actionPanel;
  }

  function buildFileName(videoUrl, extension) {
    const ext = extension.startsWith(".") ? extension : `.${extension}`;
    const parts = videoUrl.split("/");
    const lastPart = parts[parts.length - 1]?.split("?")[0];

    if (!lastPart) {
      return `x-download-${Date.now()}${ext}`;
    }

    const baseName = lastPart.replace(/\.[^/.]+$/, "");
    return `${baseName || `x-download-${Date.now()}`}${ext}`;
  }

  function triggerDownload(blob, fileName) {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
  }

  function setButtonState(button, { text, disabled, title }) {
    button.textContent = text;
    button.disabled = disabled;
    button.title = title;
  }

  async function fetchText(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Unable to download playlist ${url} (${response.status}).`);
    }

    return response.text();
  }

  async function fetchArrayBuffer(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Unable to download media segment ${url} (${response.status}).`);
    }

    return response.arrayBuffer();
  }

  function splitCodecs(codecsValue) {
    if (typeof codecsValue !== "string") {
      return { videoCodec: null, audioCodec: null };
    }

    const codecs = codecsValue
      .split(",")
      .map((codec) => codec.trim())
      .filter(Boolean);

    const videoCodec = codecs.find((codec) =>
      ["avc1", "hvc1", "hev1"].some((prefix) => codec.startsWith(prefix))
    );
    const audioCodec = codecs.find((codec) => codec.startsWith("mp4a"));

    return { videoCodec, audioCodec };
  }

  async function resolveHlsPlaylists(m3u8Url) {
    const playlistText = await fetchText(m3u8Url);

    if (!hlsUtils || !hlsUtils.isMasterPlaylist(playlistText)) {
      return { videoPlaylistUrl: m3u8Url, videoPlaylistText: playlistText };
    }

    const variants = hlsUtils.parseMasterPlaylist(playlistText, m3u8Url);
    const selectedVariant = hlsUtils.selectVariant(variants);

    if (!selectedVariant) {
      throw new Error("Unable to find a playable HLS variant.");
    }

    const audioRenditions = hlsUtils.parseAudioRenditions
      ? hlsUtils.parseAudioRenditions(playlistText, m3u8Url)
      : [];
    const selectedAudio = hlsUtils.selectAudioRendition
      ? hlsUtils.selectAudioRendition(audioRenditions, selectedVariant.audioGroupId)
      : null;

    return {
      videoPlaylistUrl: selectedVariant.uri,
      videoPlaylistText: await fetchText(selectedVariant.uri),
      audioPlaylistUrl: selectedAudio?.uri ?? null,
      audioPlaylistText: selectedAudio ? await fetchText(selectedAudio.uri) : null,
      codecs: selectedVariant.codecs || null
    };
  }

  function waitForEvent(target, eventName) {
    return new Promise((resolve, reject) => {
      const handleEvent = () => {
        cleanup();
        resolve();
      };
      const handleError = (error) => {
        cleanup();
        reject(error instanceof Error ? error : new Error(`Failed while waiting for ${eventName}.`));
      };
      const cleanup = () => {
        target.removeEventListener(eventName, handleEvent);
        target.removeEventListener("error", handleError);
      };

      target.addEventListener(eventName, handleEvent, { once: true });
      target.addEventListener("error", handleError, { once: true });
    });
  }

  function appendSourceBuffer(sourceBuffer, buffer) {
    return new Promise((resolve, reject) => {
      const handleUpdate = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Failed while appending media segments."));
      };
      const cleanup = () => {
        sourceBuffer.removeEventListener("updateend", handleUpdate);
        sourceBuffer.removeEventListener("error", handleError);
      };

      sourceBuffer.addEventListener("updateend", handleUpdate, { once: true });
      sourceBuffer.addEventListener("error", handleError, { once: true });
      sourceBuffer.appendBuffer(buffer);
    });
  }

  async function muxAudioVideoToMp4({
    videoParts,
    audioParts,
    videoMime,
    audioMime,
    recorderMime
  }) {
    const mediaSource = new MediaSource();
    const mediaUrl = URL.createObjectURL(mediaSource);
    const videoElement = document.createElement("video");

    videoElement.preload = "auto";
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.src = mediaUrl;

    await waitForEvent(mediaSource, "sourceopen");

    const videoBuffer = mediaSource.addSourceBuffer(videoMime);
    const audioBuffer = mediaSource.addSourceBuffer(audioMime);

    for (const buffer of videoParts) {
      await appendSourceBuffer(videoBuffer, buffer);
    }

    for (const buffer of audioParts) {
      await appendSourceBuffer(audioBuffer, buffer);
    }

    if (mediaSource.readyState === "open") {
      mediaSource.endOfStream();
    }

    await waitForEvent(videoElement, "loadedmetadata");
    const stream = videoElement.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: recorderMime });
    const chunks = [];

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    const stopPromise = waitForEvent(recorder, "stop");
    recorder.start();

    try {
      await videoElement.play();
      await waitForEvent(videoElement, "ended");
    } finally {
      recorder.stop();
      await stopPromise;
      URL.revokeObjectURL(mediaUrl);
      videoElement.removeAttribute("src");
      videoElement.load();
    }

    return new Blob(chunks, { type: recorderMime });
  }

  async function downloadHlsToMp4(m3u8Url, onProgress) {
    if (!hasHlsSupport) {
      throw new Error("HLS parsing utilities are unavailable.");
    }

    const {
      videoPlaylistUrl,
      videoPlaylistText,
      audioPlaylistUrl,
      audioPlaylistText,
      codecs
    } = await resolveHlsPlaylists(m3u8Url);
    const { initSegmentUrl, segmentUrls } = hlsUtils.parseMediaPlaylist(
      videoPlaylistText,
      videoPlaylistUrl
    );
    const audioPlaylist =
      audioPlaylistUrl && audioPlaylistText
        ? hlsUtils.parseMediaPlaylist(audioPlaylistText, audioPlaylistUrl)
        : null;

    if (!segmentUrls.length) {
      throw new Error("No media segments found in the HLS playlist.");
    }

    const audioSegmentsCount = audioPlaylist
      ? audioPlaylist.segmentUrls.length + (audioPlaylist.initSegmentUrl ? 1 : 0)
      : 0;
    const totalSegments = segmentUrls.length + (initSegmentUrl ? 1 : 0) + audioSegmentsCount;
    let loadedSegments = 0;
    const parts = [];
    const audioParts = [];

    const reportProgress = () => {
      loadedSegments += 1;
      onProgress?.({ loaded: loadedSegments, total: totalSegments });
    };

    if (initSegmentUrl) {
      parts.push(await fetchArrayBuffer(initSegmentUrl));
      reportProgress();
    }

    for (const segmentUrl of segmentUrls) {
      parts.push(await fetchArrayBuffer(segmentUrl));
      reportProgress();
    }

    if (audioPlaylist) {
      if (audioPlaylist.initSegmentUrl) {
        audioParts.push(await fetchArrayBuffer(audioPlaylist.initSegmentUrl));
        reportProgress();
      }

      for (const segmentUrl of audioPlaylist.segmentUrls) {
        audioParts.push(await fetchArrayBuffer(segmentUrl));
        reportProgress();
      }

      const { videoCodec, audioCodec } = splitCodecs(codecs);
      const resolvedVideoCodec = videoCodec || "avc1.42E01E";
      const resolvedAudioCodec = audioCodec || "mp4a.40.2";
      const videoMime = `video/mp4; codecs="${resolvedVideoCodec}"`;
      const audioMime = `audio/mp4; codecs="${resolvedAudioCodec}"`;
      const recorderMime = `video/mp4; codecs="${resolvedVideoCodec}, ${resolvedAudioCodec}"`;

      if (
        typeof MediaSource !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        MediaSource.isTypeSupported(videoMime) &&
        MediaSource.isTypeSupported(audioMime) &&
        MediaRecorder.isTypeSupported(recorderMime)
      ) {
        onProgress?.({ loaded: totalSegments, total: totalSegments, phase: "muxing" });
        return muxAudioVideoToMp4({
          videoParts: parts,
          audioParts,
          videoMime,
          audioMime,
          recorderMime
        });
      }
    }

    return new Blob(parts, { type: "video/mp4" });
  }

  async function handleGifDownload(video, button) {
    const videoUrl = getMp4Url(video, getPostScope(video));

    if (!videoUrl) {
      setButtonState(button, {
        text: "GIF unavailable",
        disabled: false,
        title: "Could not find a direct MP4 source for this X GIF."
      });
      return;
    }

    setButtonState(button, {
      text: "Converting…",
      disabled: true,
      title: "Downloading MP4 and converting it to GIF."
    });

    try {
      const gifBlob = await encoder.convertVideoUrlToGifBlob(videoUrl);
      triggerDownload(gifBlob, buildFileName(videoUrl, ".gif"));
      setButtonState(button, {
        text: "Downloaded",
        disabled: false,
        title: "GIF downloaded successfully."
      });
    } catch (error) {
      console.error("X GIF download failed:", error);
      setButtonState(button, {
        text: "Retry GIF",
        disabled: false,
        title: error instanceof Error ? error.message : "Failed to convert the X GIF."
      });
    }
  }

  async function handleHlsDownload(video, button, playlistOverride) {
    const playlistUrl = playlistOverride || getM3u8Url(video, getPostScope(video));

    if (!playlistUrl) {
      setButtonState(button, {
        text: "Stream unavailable",
        disabled: false,
        title: "Could not find an HLS playlist for this video."
      });
      return;
    }

    setButtonState(button, {
      text: "Fetching stream…",
      disabled: true,
      title: "Loading the HLS playlist for this video."
    });

    try {
      const mp4Blob = await downloadHlsToMp4(playlistUrl, ({ loaded, total, phase }) => {
        setButtonState(button, {
          text: phase === "muxing" ? "Muxing audio…" : `Downloading ${loaded}/${total}…`,
          disabled: true,
          title:
            phase === "muxing"
              ? "Combining audio and video into an MP4."
              : "Downloading HLS segments and assembling MP4."
        });
      });

      triggerDownload(mp4Blob, buildFileName(playlistUrl, ".mp4"));
      setButtonState(button, {
        text: "Downloaded",
        disabled: false,
        title: "MP4 downloaded successfully."
      });
    } catch (error) {
      console.error("X HLS download failed:", error);
      setButtonState(button, {
        text: "Retry MP4",
        disabled: false,
        title: error instanceof Error ? error.message : "Failed to download the HLS video."
      });
    }
  }

  async function handleMp4Download(video, button) {
    const mp4Url = getMp4Url(video, getPostScope(video));

    if (!mp4Url) {
      setButtonState(button, {
        text: "MP4 unavailable",
        disabled: false,
        title: "Could not find a direct MP4 source for this video."
      });
      return;
    }

    setButtonState(button, {
      text: "Downloading MP4…",
      disabled: true,
      title: "Downloading this video as an MP4 file."
    });

    try {
      const buffer = await fetchArrayBuffer(mp4Url);
      triggerDownload(new Blob([buffer], { type: "video/mp4" }), buildFileName(mp4Url, ".mp4"));
      setButtonState(button, {
        text: "Downloaded",
        disabled: false,
        title: "MP4 downloaded successfully."
      });
    } catch (error) {
      console.error("X MP4 download failed:", error);
      setButtonState(button, {
        text: "Retry MP4",
        disabled: false,
        title: error instanceof Error ? error.message : "Failed to download the MP4."
      });
    }
  }

  function createButton({ label, title, onClick, type }) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = BUTTON_CLASS;
    button.setAttribute(DOWNLOAD_TYPE_ATTRIBUTE, type);
    setButtonState(button, {
      text: label,
      disabled: false,
      title
    });

    button.addEventListener("click", () => {
      onClick(button);
    });

    return button;
  }

  function createActionItem(button) {
    const actionItem = document.createElement("div");

    actionItem.className = ACTION_ITEM_CLASS;
    actionItem.append(button);

    return actionItem;
  }

  function insertActionItem(actionPanel, actionItem) {
    const shareAction = actionPanel.querySelector(SHARE_ACTION_SELECTOR);

    if (shareAction) {
      actionPanel.insertBefore(actionItem, shareAction);
    } else {
      actionPanel.append(actionItem);
    }
  }

  function decorateVideo(video) {
    if (!(video instanceof HTMLVideoElement)) {
      return;
    }

    const scope = getPostScope(video);
    const isGif = hasGifBadge(video);
    const { httpUrls, blobUrls } = collectMediaUrls(video, scope);
    const mp4Url = findMp4Url(httpUrls);
    const m3u8Url = findM3u8Url(httpUrls);
    const tweetId = getTweetId(scope);
    const networkM3u8Url = tweetId ? selectNetworkM3u8Url(tweetId) : null;
    const resolvedM3u8Url = m3u8Url || networkM3u8Url;

    logOnce(
      video,
      DEBUG_LOGGED_MARKER,
      console.debug,
      `Video detected (gif=${isGif}, mp4=${Boolean(mp4Url)}, m3u8=${Boolean(
        m3u8Url
      )}, networkM3u8=${Boolean(networkM3u8Url)}, blob=${Boolean(blobUrls.length)}).`,
      { video, tweetId }
    );

    logOnce(
      video,
      MEDIA_CANDIDATES_MARKER,
      console.debug,
      `Media URLs found (http=${httpUrls.length}, blob=${blobUrls.length}).`,
      { httpUrls, blobUrls }
    );

    if (blobUrls.length > 0) {
      logOnce(
        video,
        "xgifDownloadBlobUrlNotDownloadable",
        console.debug,
        `Blob URL detected: ${blobUrls[0]}. Blob URLs are browser-internal memory references and cannot be downloaded. The video source may need to be captured directly from the network before X converts it to a blob.`,
        video
      );
    }

    const actionPanel = getActionPanel(video, scope);

    if (!actionPanel) {
      return;
    }

    const existingDownloadButton = actionPanel.querySelector(
      `[${DOWNLOAD_TYPE_ATTRIBUTE}="gif"], [${DOWNLOAD_TYPE_ATTRIBUTE}="hls"], [${DOWNLOAD_TYPE_ATTRIBUTE}="mp4"]`
    );

    if (
      isGif &&
      hasGifSupport &&
      !video.dataset[GIF_PROCESSED_MARKER] &&
      !existingDownloadButton
    ) {
      const gifButton = createButton({
        label: "Download GIF",
        title: "Download this X GIF as an animated GIF file.",
        onClick: (button) => handleGifDownload(video, button),
        type: "gif"
      });
      const actionItem = createActionItem(gifButton);

      insertActionItem(actionPanel, actionItem);
      video.dataset[GIF_PROCESSED_MARKER] = "true";
      console.info(`${LOG_PREFIX} Added GIF download button.`, video);
      return;
    }

    if (
      !isGif &&
      !video.dataset[HLS_PROCESSED_MARKER] &&
      !existingDownloadButton
    ) {
      if (hasHlsSupport && m3u8Url) {
        const hlsButton = createButton({
          label: "Download MP4",
          title: "Download this X video as an MP4 file.",
          onClick: (button) => handleHlsDownload(video, button, m3u8Url),
          type: "hls"
        });
        const actionItem = createActionItem(hlsButton);

        insertActionItem(actionPanel, actionItem);
        video.dataset[HLS_PROCESSED_MARKER] = "true";
        console.info(`${LOG_PREFIX} Added MP4 download button.`, video);
        return;
      }

      if (hasHlsSupport && resolvedM3u8Url) {
        const hlsButton = createButton({
          label: "Download MP4",
          title: "Download this X video as an MP4 file (playlist found from network activity).",
          onClick: (button) => handleHlsDownload(video, button, resolvedM3u8Url),
          type: "hls"
        });
        const actionItem = createActionItem(hlsButton);

        insertActionItem(actionPanel, actionItem);
        video.dataset[HLS_PROCESSED_MARKER] = "true";
        console.info(`${LOG_PREFIX} Added MP4 download button from network playlist.`, {
          video,
          resolvedM3u8Url
        });
        return;
      }

      if (mp4Url) {
        const mp4Button = createButton({
          label: "Download MP4",
          title: "Download this X video as an MP4 file.",
          onClick: (button) => handleMp4Download(video, button),
          type: "mp4"
        });
        const actionItem = createActionItem(mp4Button);

        insertActionItem(actionPanel, actionItem);
        video.dataset[HLS_PROCESSED_MARKER] = "true";
        console.info(`${LOG_PREFIX} Added direct MP4 download button.`, video);
        return;
      }

      // If blob URLs exist but no downloadable sources, mark as processed but log the blob detection
      if (blobUrls.length > 0) {
        video.dataset[BLOB_PENDING_MARKER] = "true";
        logOnce(
          video,
          "xgifDownloadBlobOnlyDetected",
          console.info,
          `Media detected with blob URLs only (waiting for network playlist). Post has ${blobUrls.length} blob URL(s).`,
          video
        );
      } else {
        logOnce(video, NO_MEDIA_MARKER, console.debug, "No MP4, HLS, or blob source found for video.", video);
      }
    }
  }

  function scanPosts(rootNode = document) {
    if (!(rootNode instanceof Element) && rootNode !== document) {
      return;
    }

    const posts =
      rootNode === document
        ? rootNode.querySelectorAll(POST_SELECTOR)
        : rootNode.matches(POST_SELECTOR)
          ? [rootNode]
          : rootNode.querySelectorAll(POST_SELECTOR);

    posts.forEach((post) => {
      logOnce(post, POST_LOGGED_MARKER, console.debug, `Post found "${post.tagName.toLowerCase()}".`, post);

      const video = post.querySelector("video");

      if (video) {
        logOnce(post, POST_HAS_MEDIA_MARKER, console.debug, 'gif/video found "video tag".', video);
        decorateVideo(video);
        return;
      }

      logOnce(post, POST_NO_MEDIA_MARKER, console.debug, "post doesnt contain gif/video.", post);
    });
  }

  function scan(rootNode = document) {
    scanPosts(rootNode);

    if (rootNode instanceof HTMLVideoElement) {
      decorateVideo(rootNode);
      return;
    }

    if (rootNode instanceof HTMLSourceElement) {
      const parentVideo = rootNode.closest("video");

      if (parentVideo) {
        decorateVideo(parentVideo);
      }
      return;
    }

    if (!(rootNode instanceof Element) && rootNode !== document) {
      return;
    }

    const videos =
      rootNode === document
        ? rootNode.querySelectorAll("video")
        : rootNode.matches("video")
          ? [rootNode]
          : rootNode.querySelectorAll("video");

    if (rootNode === document && videos.length === 0 && !loggedEmptyScan) {
      loggedEmptyScan = true;
      console.debug(`${LOG_PREFIX} No videos found during initial scan.`, document.location.href);
    }

    videos.forEach(decorateVideo);
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes") {
        scan(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        scan(node);
      });
    });
  });

  scan();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-src", "data-url", "href"]
  });
})(globalThis);
