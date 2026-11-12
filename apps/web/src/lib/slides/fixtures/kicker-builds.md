---
title: 步驟與堆疊
type: slide
slideOptions:
  engine: contour
  structure: headings
---

#### 開場｜兩分鐘

# 步驟與堆疊

一份用 `####` 為區塊命名的簡報。

:::summary
〔開場〕先說這份簡報要測什麼。

第二段講稿。
:::

---

#### 一、逐步顯示

## 清單一項一步

:::build
- 第一項
- 第二項，含 **粗體** 與 `程式碼`
- 第三項
:::

:::summary
清單的三個項目各是一步。
:::

### 有序清單

:::build
1. 有序清單
2. 也是一項一步
:::

接著是不在 build 裡的段落。

### 表格與其他區塊

:::build
| 元素 | 一步是什麼 |
| ---- | ---------- |
| 清單 | 一個項目   |
| 表格 | 一列       |
| 其他 | 整個區塊   |

一個段落也是一步。

> 引言也是一步。
:::

:::summary
`###` 是同一張投影片的下一頁。
:::

## 表格不在 build 裡

| 欄 | 值 |
| -- | -- |
| a  | 1  |
| b  | 2  |

## 格線與資訊框

::::grid{cols=3}
:::cell
**一**

第一欄
:::
:::cell
**二**

第二欄
:::
:::cell
**三**

第三欄 :icon{name="Star"}
:::
::::

:::info[補充]
資訊框裡的內容，含公式 $a^2 + b^2 = c^2$。
:::

:::summary
每個 `##` 開一張新的投影片。
:::

---

#### 二、程式與圖

## 圍籬裡的指令不算

```md
::vertical

:::build
- 這是範例，不是步驟
:::

::summary
```

    ::vertical

    :::build
    - 縮排的程式碼也不是步驟
    :::

```mermaid
graph TD
  A --> B
```

$$
\frac{1}{2}
$$

:::summary
程式碼裡的 `::vertical` 與 `:::build` 是程式碼。
:::

---

#### 附錄 A｜名詞

## 區塊

講述的一個段落。

***

::block{title="附錄 B｜分隔線" minutes=2.5 kind=appendix #rules}

::slide{#stars}

## 另一種分隔線

`***` 也開始下一個區塊。
