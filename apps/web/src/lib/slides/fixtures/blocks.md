---
title: 明寫區塊
type: slide
---

# 明寫區塊

第一個 `::block` 之前的投影片，歸在以簡報標題命名的區塊。

---

::block{title="一、主要問題" minutes=5}

::slide{#dilemma}

## 兩難

:::build
- 甲
- 乙
:::

:::summary
這張投影片有自己的 id。
:::

::vertical

## 兩難

同一個 `##`，所以是第二頁。

::vertical

::slide{#way-out}

### 出路

帶著 `::slide` 的子頁開一張新的投影片。

---

::block{title="二、回應" minutes=2.5 short=回 #replies}

---

## 第一個回應

單獨寫在兩個 `---` 之間的 `::block` 套用到下一張。

---

## 第二個回應

仍在同一個區塊。

---

::block{title="附錄 A｜文獻" kind=appendix}

## 文獻

- 一
- 二
