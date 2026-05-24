# X_Gif_downloader

Chrome extension that adds a **Download GIF** button to GIF posts on X/Twitter, fetches the underlying MP4 file, and converts it into an animated GIF directly in the browser.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the folder where you cloned or downloaded this extension

## How it works

- watches X/Twitter pages for GIF posts
- adds an overlay **Download GIF** button to each detected GIF video
- downloads the backing MP4 asset
- converts the video frames into a GIF in the browser
- saves the generated `.gif` file to your machine
МАЙНДЫ:
ДОСТАВАТЬ ИЗ NETWORK ссылки на видео (ТАМЖЕ и айди поста парсить) и пытаться скачать и собрать в лучшем возможном качестве
