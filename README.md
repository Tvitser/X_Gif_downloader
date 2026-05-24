# X_Gif_downloader

Chrome extension that adds **Download GIF** and **Download MP4** buttons to X/Twitter posts, fetching MP4 or HLS streams and saving them directly in the browser.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the folder where you cloned or downloaded this extension

## How it works

- watches X/Twitter pages for GIF and video posts
- adds an overlay **Download GIF** button to each detected GIF video
- adds a **Download MP4** button to HLS-backed video posts
- downloads the backing MP4 or HLS segments
- converts GIF videos into a GIF in the browser
- saves the generated `.gif` or `.mp4` file to your machine
