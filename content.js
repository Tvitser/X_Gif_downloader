(function initializeXGifDownloader(root) {
  const encoder = root.XGifEncoder;

  if (!encoder || typeof encoder.convertVideoUrlToGifBlob !== "function") {
    return;
  }

  const BUTTON_CLASS = "xgif-download-button";
  const ACTION_ITEM_CLASS = "xgif-download-action";
  const PROCESSED_MARKER = "xgifDownloadAttached";
  const ACTION_PANEL_TEST_ID_SELECTORS = [
    '[data-testid="reply"]',
    '[data-testid="retweet"]',
    '[data-testid="like"]',
    '[data-testid="bookmark"]',
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

  function getPostScope(video) {
    return (
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

  function isActionPanel(group) {
    return Boolean(group.querySelector(ACTION_PANEL_SELECTOR));
  }

  function getActionPanel(video) {
    const scope = getPostScope(video);

    if (!scope) {
      return null;
    }

    return Array.from(scope.querySelectorAll('[role="group"]')).find(isActionPanel) || null;
  }

  function buildFileName(videoUrl) {
    const parts = videoUrl.split("/");
    const lastPart = parts[parts.length - 1]?.split("?")[0] || `x-gif-${Date.now()}`;
    return lastPart.replace(/\.mp4$/i, ".gif");
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

  async function handleDownload(video, button) {
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
      triggerDownload(gifBlob, buildFileName(videoUrl));
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

  function createButton(video) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = BUTTON_CLASS;
    setButtonState(button, {
      text: "Download GIF",
      disabled: false,
      title: "Download this X GIF as an animated GIF file."
    });

    button.addEventListener("click", () => {
      handleDownload(video, button);
    });

    return button;
  }

  function createActionItem(video) {
    const actionItem = document.createElement("div");

    actionItem.className = ACTION_ITEM_CLASS;
    actionItem.append(createButton(video));

    return actionItem;
  }

  function decorateVideo(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset[PROCESSED_MARKER]) {
      return;
    }

    if (!hasGifBadge(video)) {
      return;
    }

    const actionPanel = getActionPanel(video);

    if (!actionPanel || actionPanel.querySelector(`.${BUTTON_CLASS}`)) {
      return;
    }

    const actionItem = createActionItem(video);
    const shareAction = actionPanel.querySelector(SHARE_ACTION_SELECTOR);

    if (shareAction) {
      actionPanel.insertBefore(actionItem, shareAction);
    } else {
      actionPanel.append(actionItem);
    }

    video.dataset[PROCESSED_MARKER] = "true";
  }

  function scan(rootNode = document) {
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
      mutation.addedNodes.forEach((node) => {
        scan(node);
      });
    });
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})(globalThis);
