---
name: github-notes-workspace
description: Use when initializing or manipulating a GitHub Notes workspace, notebooks, notes, or manifests.
---

# GitHub Notes Workspace Management

Follow this workflow when creating or updating workspace manifests, notebooks, notes, or assets.

## Workspace Hierarchy

```text
Workspace (/.mygitnotes.yaml)
└─ Notebooks (e.g. notes/example/)
   └─ Notes (*.md) & Assets (assets/)
```

## Invariants

1. **Manifest Location**: `/.mygitnotes.yaml` (or legacy `/.github-notes.yaml`) exists only on user workspace branches (e.g. `main`), never on `core`.
2. **Notebook Slugs**: Notebook IDs must be unique URL/filesystem-safe slugs.
3. **Roots**: Notebook roots must be relative to repository root and must not overlap.
4. **Frontmatter**: Preserve unknown frontmatter keys. A note without frontmatter is valid.
5. **Status Labels**: A notebook's `statuses` entries are a name or `{ name, color?, label? }`. `name` is the value stored in a note's `status:` and never changes with the UI language. `label` is display-only: one string, or a map of UI language tag to string (`label: { en: In progress, zh-TW: 進行中 }`). Never put a label into a note's frontmatter. A missing label falls back to the built-in name of a default status (`inbox`, `working`, `done`, `archived` in `zh-TW` only; English shows `name` as written), then to `name`. Always write `name`, never a label.
6. **Git Save**: Every programmatic or user edit transaction should create a clean Git commit.

## 任務、負責人、優先順序與里程碑語法

這些都是筆記裡的純文字；寫入時沿用，不要另建欄位，也不要改動沒有用到的筆記。

1. **任務行**：`- [ ] 內容`，完成後 `- [x] 內容 ✅ YYYY-MM-DD`。日期標記：`🛫 YYYY-MM-DD` 開始、`📅 YYYY-MM-DD` 到期。
2. **負責人**：任務文字開頭或空白之後的 `@名字`，例如 `- [ ] @小林 @alice 寫規格 📅 2026-10-30`。名字用字母、數字、`_`，`.` 或 `-` 只放在名字中間；可寫多位。`a@b.com`、網址與 `@types/node` 不是負責人。
3. **優先順序**：任務行放一個 Obsidian Tasks 表情符號：`🔺` 最高、`⏫` 高、`🔼` 中、`🔽` 低、`⏬` 最低；不寫就是一般。
4. **里程碑**：該筆記的 frontmatter 寫 `milestone: YYYY-MM-DD`（真實日期的字串）。不要用 `due`，它是任務到期日的用語。
5. 勾選或取消勾選任務只增減 `✅ 日期`；其他標記與負責人原樣保留。

## 資料夾索引

建立或整理資料夾入口時：

1. 先讀 manifest，確認目標筆記本的 `root`。在該根目錄或任意子資料夾使用 `index.md` 或 `README.md`，大小寫依此命名；例如 `notes/example/index.md` 或 `notes/example/projects/README.md`。只代表所在資料夾，不套用到其他層級。兩者都有時選用 `index.md`，未選用的 `README.md` 保留為一般筆記。
2. 索引使用一般 Markdown，可省略 frontmatter；保留既有欄位。連結相對於索引檔案所在位置，例如根目錄索引中的 `[專案](projects/)` 或 `[每週回顧](projects/weekly-review.md)`。不要為了卡片名稱把正文標題或 frontmatter title 強制改成「索引」。
3. 列表、卡片及看板的資料夾卡片列，會把索引放在第一張白色文件圖示卡片，介面標示「索引」或「Index」。點擊後沿用一般筆記的開啟及編輯流程，不在資料夾畫面直接展示正文；該份索引不再重複列於下方筆記區。
4. 先依檔名優先序選定索引，再套用隱藏筆記設定；`index.md` 存在但被隱藏時，不會改用 `README.md`，需開啟「顯示隱藏筆記」才顯示索引卡片。搜尋、狀態／標籤篩選及「攤開」不顯示索引卡片，索引檔仍可依一般筆記規則出現在符合條件的結果中。資料夾名稱與排序仍由 `_dir.yml` 管理，勿用索引檔取代它。
5. 完成前確認目標資料夾的索引卡片位置、點開的檔案路徑與相對連結；只有索引而沒有其他筆記的資料夾也應顯示卡片，不應誤報為空資料夾。

可操作的教學範例位於 `examples/demo-workspace/notes/example/index.md`。Core 維護教學時修改 examples；不要把教學寫入使用者的 `notes/**`。

## Image annotations (`:::annotate`)

A note holds review comments on an image as plain Markdown. Read and write the rows directly; an agent that can see the image adds a row by coordinates.

```markdown
:::annotate[Homepage v3 review]
![Homepage v3](/raw-assets/by-hash/3f2a9c0d6b1e4f5a8c7d2e9b0a1f3c4d5e6f7a8b)

- {#1 pin x=41.2% y=23.3%} The logo is small and misses the nav baseline.
- {#2 region x=8% y=61.5% w=35% h=12% by=alice} CTA contrast is low.
  Check the hover state too.
- {#3 pin x=88% y=7% resolved by=bob} Make the avatar round.
:::
```

- The first body line is one inline Markdown image (any ref a note image takes; prefer `/raw-assets/by-hash/<hash>`, which pins the version). Rows follow after a blank line, one list item each.
- `x`, `y`, `w`, `h` are percentages (`41.2%`) of the image width and height from its top-left corner; a pin has `x y`, a region `x y w h` and must fit inside the image. `resolved` is a bare word; `by=name` is optional (`by="Ann Lee"` with spaces).
- `#n` is the number shown on the marker: new rows take the highest number plus one, ids are unique in the block, and deleting a row never renumbers the others.
- The comment is the Markdown after `}` and its indented continuation lines.
- In the app a person sees and edits these rows in the note's figure or, after clicking the image, in the image preview; both write the same rows into the note's text, so a change made there reads like any other edit of the block. A PDF page opens no preview.
- Change only the row you mean to: edit a value in place, add or remove the word `resolved`, append a row at the end. Do not reorder, renumber or reformat other rows. An unknown word (such as a misspelt `resolved`) or a bad value makes the row show a problem tag, so check what you wrote.

### PDF pages

The same block annotates a PDF. The first body line is an inline Markdown **link**, not an image, and every row carries `page=N`:

```markdown
:::annotate[Contract draft review]
[Contract v2.pdf](/raw-assets/by-hash/9c1e0d2b7a4f5e6d8c3b2a1f0e9d8c7b6a5f4e3d)

- {#1 region x=12% y=18.5% w=76% h=9% page=1 by=alice} The party name must match the seal page.
- {#2 pin x=63% y=41% page=3} Confirm the penalty rate in clause 5.
:::
```

- Write a PDF as a link. `![name](file.pdf)` is a block error; a reference-style link is too.
- `page=N` counts pages from 1 at the start of the file (not the printed page label). A row without it, or with `page=0`, `page=2.5` or `page=3%`, shows a problem tag and no marker. A page past the file's end gets a problem tag once the app has loaded the PDF.
- `x y w h` are percentages of the page as a viewer shows it, with the page's own rotation applied, from its top-left corner.
- Ids are unique in the block, not per page. An agent places rows only if it can see the page; no tool here renders PDF pages.
