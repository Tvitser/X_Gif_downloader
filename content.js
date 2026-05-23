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
  const ACTION_PANEL_TEST_ID_SELECTORS = [
    '[data-testid="reply"]',
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
    '[aria-label*="Like"]'
  ];
  const ACTION_PANEL_SELECTOR = [
    ...ACTION_PANEL_TEST_ID_SELECTORS,
    ...ACTION_PANEL_ARIA_SELECTORS
  ].join(", ");
  const SHARE_ACTION_SELECTOR = '[data-testid="share"]';

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

  function getMp4Url(video) {
    const sourceUrls = [
      video.currentSrc,
      video.src,
      ...Array.from(video.querySelectorAll("source")).map((source) => source.src)
    ];

    return sourceUrls.find((url) => typeof url === "string" && /^https?:/.test(url) && url.includes(".mp4"));
  }

  function getM3u8Url(video) {
    const sourceUrls = [
      video.currentSrc,
      video.src,
      ...Array.from(video.querySelectorAll("source")).map((source) => source.src)
    ];

    const m3u8Url = sourceUrls.find(
      (url) =>
        typeof url === "string" && /^https?:/.test(url) && url.toLowerCase().includes(".m3u8")
    );

    return normalizeUrl(m3u8Url);
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

  function getActionPanel(video) {
    const scope = getPostScope(video);

    if (!scope) {
      return null;
    }

    const actionButton = findActionButton(scope);

    if (!actionButton) {
      return null;
    }

    return (
      actionButton.closest('[role="group"]') ||
      Array.from(scope.querySelectorAll('[role="group"]')).find(isActionPanel) ||
      findActionPanelFromButton(actionButton) ||
      actionButton.parentElement
    );
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
    const videoUrl = getMp4Url(video);

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
    const playlistUrl = getM3u8Url(video);

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

    const actionPanel = getActionPanel(video);

    if (!actionPanel) {
      if (!video.dataset[NO_PANEL_MARKER]) {
        console.debug(`${LOG_PREFIX} Action panel not found for video.`, video);
        video.dataset[NO_PANEL_MARKER] = "true";
      }
      return;
    }

    const isGif = hasGifBadge(video);

    if (
      isGif &&
      hasGifSupport &&
      !video.dataset[GIF_PROCESSED_MARKER] &&
      !actionPanel.querySelector(`[${DOWNLOAD_TYPE_ATTRIBUTE}="gif"]`)
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
      hasHlsSupport &&
      !video.dataset[HLS_PROCESSED_MARKER] &&
      !actionPanel.querySelector(`[${DOWNLOAD_TYPE_ATTRIBUTE}="hls"]`)
    ) {
      const hlsUrl = getM3u8Url(video);

      if (!hlsUrl) {
        return;
      }

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
    }
  }

  function scan(rootNode = document) {
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
    attributeFilter: ["src"]
  });
})(globalThis);
