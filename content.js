(function initializeXGifDownloader(root) {
  const encoder = root.XGifEncoder;

  if (!encoder || typeof encoder.convertVideoUrlToGifBlob !== "function") {
    return;
  }

  const BUTTON_CLASS = "xgif-download-button";
  const PROCESSED_MARKER = "xgifDownloadAttached";

  function getOverlayContainer(video) {
    return (
      video.closest('[data-testid="videoComponent"]') ||
      video.closest('[data-testid="videoPlayer"]') ||
      video.parentElement
    );
  }

  function hasGifBadge(video) {
    const scope =
      video.closest("article") ||
      video.closest('[data-testid="cellInnerDiv"]') ||
      video.parentElement;

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

  function buildFileName(videoUrl) {
    const parts = videoUrl.split("/");
    const lastPart = parts[parts.length - 1]?.split("?")[0] || `x-gif-${Date.now()}.mp4`;
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

  function decorateVideo(video) {
    if (!(video instanceof HTMLVideoElement) || video.dataset[PROCESSED_MARKER]) {
      return;
    }

    if (!hasGifBadge(video)) {
      return;
    }

    const overlayContainer = getOverlayContainer(video);

    if (!overlayContainer || overlayContainer.querySelector(`.${BUTTON_CLASS}`)) {
      return;
    }

    if (getComputedStyle(overlayContainer).position === "static") {
      overlayContainer.style.position = "relative";
    }

    overlayContainer.append(createButton(video));
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
