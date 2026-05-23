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

    try {
      return new URL(url, window.location.href).toString();
    } catch (error) {
      return null;
    }
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

    const addUrl = (value) => {
      if (typeof value !== "string") {
        return;
      }

      const trimmed = value.trim();

      if (!trimmed) {
        return;
      }

      urls.add(trimmed);
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

    return Array.from(urls);
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
    return findMp4Url(collectMediaUrls(video, scope));
  }

  function getM3u8Url(video, scope) {
    return findM3u8Url(collectMediaUrls(video, scope));
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

  async function resolveMediaPlaylist(m3u8Url) {
    const playlistText = await fetchText(m3u8Url);

    if (!hlsUtils || !hlsUtils.isMasterPlaylist(playlistText)) {
      return { playlistUrl: m3u8Url, playlistText };
    }

    const variants = hlsUtils.parseMasterPlaylist(playlistText, m3u8Url);
    const selected = hlsUtils.selectVariant(variants);

    if (!selected) {
      throw new Error("Unable to find a playable HLS variant.");
    }

    return {
      playlistUrl: selected.uri,
      playlistText: await fetchText(selected.uri)
    };
  }

  async function downloadHlsToMp4(m3u8Url, onProgress) {
    if (!hasHlsSupport) {
      throw new Error("HLS parsing utilities are unavailable.");
    }

    const { playlistUrl, playlistText } = await resolveMediaPlaylist(m3u8Url);
    const { initSegmentUrl, segmentUrls } = hlsUtils.parseMediaPlaylist(playlistText, playlistUrl);

    if (!segmentUrls.length) {
      throw new Error("No media segments found in the HLS playlist.");
    }

    const totalSegments = segmentUrls.length + (initSegmentUrl ? 1 : 0);
    let loadedSegments = 0;
    const parts = [];

    if (initSegmentUrl) {
      parts.push(await fetchArrayBuffer(initSegmentUrl));
      loadedSegments += 1;
      onProgress?.({ loaded: loadedSegments, total: totalSegments });
    }

    for (const segmentUrl of segmentUrls) {
      parts.push(await fetchArrayBuffer(segmentUrl));
      loadedSegments += 1;
      onProgress?.({ loaded: loadedSegments, total: totalSegments });
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

  async function handleHlsDownload(video, button) {
    const playlistUrl = getM3u8Url(video, getPostScope(video));

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
      const mp4Blob = await downloadHlsToMp4(playlistUrl, ({ loaded, total }) => {
        setButtonState(button, {
          text: `Downloading ${loaded}/${total}…`,
          disabled: true,
          title: "Downloading HLS segments and assembling MP4."
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
    const mediaUrls = collectMediaUrls(video, scope);
    const mp4Url = findMp4Url(mediaUrls);
    const m3u8Url = findM3u8Url(mediaUrls);

    logOnce(
      video,
      DEBUG_LOGGED_MARKER,
      console.debug,
      `Video detected (gif=${isGif}, mp4=${Boolean(mp4Url)}, m3u8=${Boolean(m3u8Url)}).`,
      video
    );

    logOnce(
      video,
      MEDIA_CANDIDATES_MARKER,
      console.debug,
      `Media URLs found (${mediaUrls.length}).`,
      mediaUrls
    );

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
          onClick: (button) => handleHlsDownload(video, button),
          type: "hls"
        });
        const actionItem = createActionItem(hlsButton);

        insertActionItem(actionPanel, actionItem);
        video.dataset[HLS_PROCESSED_MARKER] = "true";
        console.info(`${LOG_PREFIX} Added MP4 download button.`, video);
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

      logOnce(video, NO_MEDIA_MARKER, console.debug, "No MP4 or HLS source found for video.", video);
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
