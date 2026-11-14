---
title: 頁面背景
type: slide
slideOptions:
  engine: contour
  structure: headings
---

#### 開場｜背景

::background{image="https://example.com/board.jpg" dim=0.6 credit="Photo: A. B., CC BY-SA 4.0"}

# 頁面背景

背景在開場那一頁，沒有內容，所以不自成一張投影片。

## 影片

::background{video="https://example.com/clip.mp4" start=12 end=40 poster="https://example.com/clip.jpg" dim=0.5 position="50% 20%"}

背景和講稿都不算內容：下面的 `###` 緊接在 `##` 之後，兩者同屬第一頁。

:::summary
〔講稿〕背景寫在講稿旁邊。
:::

### YouTube

::background{youtube="https://www.youtube.com/watch?v=dQw4w9WgXcQ" start=30 poster="https://example.com/frame.jpg"}

這一頁的背景寫在內容之後。

---

## 沒有圖片的影片

內容在先。

::background{video="https://example.com/loop.mp4"}
