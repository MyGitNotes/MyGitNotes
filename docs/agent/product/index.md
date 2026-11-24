# MyGitNotes — Product Agent Instructions

Welcome to the **MyGitNotes** product codebase. This document guides AI coding and maintenance agents working on the application source code and infrastructure.

## 1. What MyGitNotes Is

MyGitNotes is a Git-native, local-first notes application and agent-operable workspace frontend. It stores notes as pure Markdown with optional YAML frontmatter, provides List, Card, and Kanban views, tracks every explicit save as a Git commit, and exposes a safe local MCP interface for coding agents.

## 2. Branch & Ownership Contract

- **`core`**: Canonical product branch and default branch of the public repository. Contains application source code, packages, scripts, tests, Agent templates, and documentation. Never contains real user data.
- **`main`**: User workspace branch created after cloning via `pnpm bootstrap-workspace`. Contains user workspace config (`/.mygitnotes.yaml`, or the legacy `/.github-notes.yaml`) and user notes (`notes/**`). In the public repository, `main` also serves as the demo workspace branch and is **automatically merged with `core` via GitHub Actions (`.github/workflows/release-main.yml`)** whenever `core` is pushed.

### Path Ownership Invariants
- **Core-owned paths**: `apps/**`, `packages/**`, `scripts/**`, `docs/**`, `examples/**`, `README.md`, `package.json`, `pnpm-workspace.yaml`.
- **User-owned paths**: `notes/**`, `/.mygitnotes.yaml` (or legacy `/.github-notes.yaml`), `/AGENTS.md`, `/CLAUDE.md`, `/GEMINI.md`, `/.agents/**`, `/.codex/**`, `/.claude/**`, `/.agent/**`. Core must not track workspace Agent files; keep product guidance here and starter templates in `examples/workspace-agent-system/`.
- **Rule**: NEVER overwrite, alter, or delete content under `notes/**` during Core maintenance or Core update merges.

## 3. Product Documentation Map

Detailed architecture, security, and workflow guides live in `docs/agent/`:
- Overview: [`docs/agent/index.md`](../index.md)
- Architecture: [`docs/agent/architecture/index.md`](../architecture/index.md)
- Workflows: [`docs/agent/workflows/index.md`](../workflows/index.md)
- Security & Guards: [`docs/agent/security/index.md`](../security/index.md)
- MCP Server: [`docs/agent/mcp/index.md`](../mcp/index.md)

## 4. Repo-Local Codex Skills

Product development skills are maintained in `docs/agent/product/skills/`:
- `github-notes-dev`: Product development, testing, boundaries, and validation.
- `github-notes-workspace`: Initializing and manipulating workspaces, notebooks, notes, and manifests.
- `github-notes-core-update`: Safe fast-forward Core updates and one-time workspace conversion without data loss.
- `github-notes-mcp`: Developing, testing, and invoking the local MCP server safely.

## 5. Local MCP Usage & Safety

- Stdio transport is used for local agent integration.
- Strictly enforce repository root resolution, path traversal (`..`) prevention, and symlink escape rejection.
- Normal note mutation tools operate only on user branches (`main`).
- Multi-file saves are atomic and return git commit hashes.

## 6. Secrets Policy

- Never commit secrets, tokens, or API keys (`GEMINI_API_KEY`, `GH_TOKEN`, `SESSION_SECRET`).
- Respect `.gitignore` for `.env*` files.
- `.env.example` contains only placeholder names.

## 7. Verification Commands

Before concluding any work on the product source:
```bash
pnpm test          # Run test suite across all packages
pnpm build         # Verify build succeeds cleanly
```

Browser QA scripts (`node scripts/qa-*.mjs`) drive the built `apps/local-server/dist` and `apps/web/dist` output and run without setup on macOS and Linux CI; set `PUPPETEER_EXECUTABLE_PATH` (`GRAPH_QA_CHROME` for `qa-graph-*.mjs`) only to point at a Chrome binary other than the platform default.


### 合輯所有權

合輯是筆記本內的 `<名稱>.compilation.yml`，屬於使用者的筆記內容，與筆記一樣由 Git 追蹤與同步。
路徑所在的筆記本擁有合輯，檔案不重複 `notebookId`。
項目以儲存庫相對路徑記錄，可以指向同一儲存庫的任何筆記本；項目的筆記本由路徑所在的筆記本根目錄決定（`compilationRow` 的 `notebookOf`），只在合輯自己的儲存庫內找，不會解析到其他儲存庫根目錄相同的筆記本。
路徑不在任何筆記本內的項目仍可讀檔，顯示為找不到；動態合輯的資料夾來源必須在儲存庫某個筆記本內，否則檔案無效；標籤來源只查合輯自己的筆記本。
`parseCompilation` 收儲存庫全部筆記本的根目錄，只檢查資料夾來源；目錄（本機與遠端）、學習路由與瀏覽器都用同一範圍。
跨合輯拖曳項目限同一儲存庫（「Items stay inside their repository」）；新增項目的對話框可選同一儲存庫的筆記本，預設合輯自己的。
學習時，合輯可在筆記所屬儲存庫的任何筆記本內；預設階段取合輯自己筆記本的狀態，所以其他筆記本的筆記可能得到該筆記本沒定義的狀態（看板會多一欄）。
關聯圖排列只畫合輯自己筆記本的成員，並顯示「N items in other notebooks are not shown in the graph」／「另有 N 個項目在其他筆記本，關聯圖不顯示」，開啟時不寫檔。
同一儲存庫裡能讀合輯的人就能讀所有筆記本，所以不會出現讀不到的項目；未來若有跨儲存庫或分享合輯，讀不到的項目採鎖定並隱藏標題。
舊版用戶端讀到跨筆記本的合輯會標為無效（「outside the notebook」），不會丟棄或改寫；檔案格式與 `version` 不變，Pro 與社群版要一起升級。
`packages/core/src/compilation.ts` 定義檔案格式；筆記目錄把它索引為 `compilation` 種類，`/api/notes/facets` 回傳各筆記本的合輯數，`/api/notes/query` 接受 `kind=compilation`。
搬移或重新命名筆記與資料夾時，`workspace-documents.ts` 與合輯模組一併改寫合輯內的參照，包括 `manualOrder`。
動態合輯的 `sort.field: manual` 依 `manualOrder` 的成員路徑排列，沒列入的成員依更新時間由舊到新接在後面；手動模式一次載入全部成員，選其他排序時保留 `manualOrder`。
檔案的 `arrangement` 是 `lane`、`book` 或 `graph`；書本寫作 `book`。
舊版的 `stack` 仍可讀，當作書本開啟，開啟、列出、搜尋或學習都不會寫回。
只有合輯自己被編輯（改名、項目、來源、排序、手動順序、排列、學習設定、複製）時才改寫成 `book`，`stack` 不再被寫出。
搬移或重新命名筆記與資料夾、筆記的標籤與狀態編輯，保持檔案原本的 token。
目錄摘要的 `arrangement` 對兩種 token 都回報 `book`；`schema_version` 與檔案的 `version: 1` 不變，也沒有遷移步驟。
舊版用戶端讀到 `book` 會把該合輯標為無效並附上原因，不會丟棄或改寫；Pro 與社群版要一起升級。
書本的閱讀方式（連續捲動或分頁）是每台裝置的檢視偏好，存在瀏覽器 `localStorage`（`github-notes:book-reading-mode`，預設連續），切換不寫合輯檔案、不產生 commit。
分頁以章節 `id` 追蹤，一次只繪製一章；← → 在 KEYMAP 的 `book` 範圍，觸控滑動由書本內文處理，兩者都不在編輯器、輸入框與正在編輯的區段內作用；離開正在編輯的頁面前走合輯編輯狀態的 `finish()`，儲存失敗就留在原頁。
資料夾章節的小節要等該頁載入過才列進目錄，離開後仍保留到章節本身離開書本；有多本書同時開著時，焦點在頁面上（沒有聚焦任何元件）的 ← → 只翻最後操作過的那一本。

自訂合輯的 `items` 可以放章名項目 `{ id, kind: heading, title }`（`title` 去頭尾空白後 1–100 字，沒有 `path`）：章名開始一章，收它之後到下一個章名之前的項目；第一個章名之前的項目各自成章。只有一層章名。
內容項目（筆記、資料夾、附件、影片）上限 100，章名另計，上限也是 100；`id` 在所有項目（含章名）間不可重複。`compilationChapters` 是章結構的唯一來源，`contentItems` 去掉章名；目錄摘要的 `itemCount` 只算內容項目，有章名時另給 `chapterCount`。
筆記項目可以帶 `anchor`（去頭尾空白後 1–200 字，不含控制字元），比對方式與 `#標題` 連結相同（`headingSlug`，同名取第一個），只顯示該標題到下一個同級或更高級標題之間的內容；其他種類的項目不接受 `anchor`。標題改名不會改寫 `anchor`，項目顯示找不到並提供開啟整篇筆記。帶 `anchor` 的項目不在合輯裡就地編輯，編輯時在放大檢視開啟整篇筆記並捲到該標題；學習與關聯圖把同一篇筆記的多個段落算成一篇。
動態合輯可以設 `group: folder`（只能搭配 `source`），每個有成員的資料夾成為一章：伺服器以 `group=folder` 分頁，章的順序是資料夾來源本身的筆記、再依側欄的資料夾順序，未列入側欄的資料夾依路徑排在後面；手動順序只在各章內比較。章名項目只存在於瀏覽器，學習與關聯圖不受影響。
章名、`anchor` 與 `group` 都不需要遷移，檔案 `version` 仍是 1。舊版用戶端讀到這三者會把合輯標為無效並附原因，仍列出標題，除了搬移時改寫 `path`、`source.path` 與 `manualOrder` 之外不會改寫檔案；Pro 與社群版要一起升級。
最外層可選填 `description`，須為字串，去掉頭尾空白後最多 500 字；空字串視同未填。
合輯標題下方與目錄摘要都會帶出這段說明。
MyGitNotes 允許不認得的最外層欄位（例如部落格用的 `translationKey`）；合輯項目內仍只接受該種類定義的欄位。
App 儲存合輯時先寫已知欄位，再依原順序寫回不認得的欄位，保留其 YAML 值。
App 重建合輯時，不保證保留已知欄位的註解或格式；搬移與修改標籤、狀態時只改需要改的值。

舊版 `.github-notes-screen.yaml` 只由 `migrate-workspace`（schema 2 → 3）讀取：每條河道轉成 `<筆記本根目錄>/<slug(名稱)>.compilation.yml`，名稱衝突加 `-2`、`-3`，保留 `id`、排列、項目或來源、排序、學習設定與關聯圖，並和新建合輯一樣帶入所屬筆記本的第一個狀態；Focus 的 `lane` 分頁改為指向新檔的路徑分頁，河道已不存在的分頁刪除；每個儲存庫提交一個遷移 commit。
`SUPPORTED_SCHEMA_VERSION` 為 3，本機啟動遇到 schema 2 會拒絕並指向 `pnpm migrate-workspace`。

### 學習資料所有權

工作區根目錄 `.github-notes-study.yaml` 保存使用者的卡片對應、排程與事件。Core 維護及更新保留此檔案；示範正文位於 `examples/study/`，測試學習紀錄建立於隔離工作區。使用方式見 [學習指南](../study.md)。

### Focus 配置所有權

工作區根目錄 `.github-notes-focus.yaml` 保存使用者具名 Focus 的名稱，以及窗格分割樹：節點是窗格（`id`、tab）或分割（`id`、方向、子節點），節點 `id` 在一個 Focus 內不重複；窗格最多 8 個、分割巢狀最多 4 層。
窗格或分割節點可帶 `size`（1–100 的整數，是同一分割內兄弟節點的份額，只在每個兄弟都有時才生效，只存在 version 3）；平常拖曳出的大小是各裝置的檢視狀態，不存在檔案裡。App 內的結構編輯（例如拆分窗格）會丟掉它動到的分割的 `size`。
檔案格式為 version 2，帶 `size` 時為 version 3（`size` 只在 version 3 讀入，version 1、2 維持嚴格；舊版 core 把 version 3 當成較新的版本而拒絕，需要 core 0.13.8 以上，否則該倉庫的筆記搬移也會被擋）；version 1（劃分加窗格清單）讀入時依劃分決定性地轉成樹（窗格 `p1`…，分割 `id` 取自劃分名稱），同一個檔案讀兩次結果相同。
寫入時，只要每個 Focus 都剛好是七種舊劃分之一且沒有 `size`，仍寫成 version 1，讓只認得 version 1 的部署繼續運作；任何一個 Focus 成為其他形狀，整個檔案就寫成 version 2；任何一個節點有 `size`，整個檔案寫成 version 3。收回這個 version 1 寫入要等所有部署都跨過 phase 1，由使用者決定。
Core 不得追蹤真實配置，工作區更新必須保留此檔案；測試配置只建立於隔離暫存工作區。
每個 Focus 記錄 `notebookId`，tab 只參照該筆記本的筆記或合輯（路徑分頁）；預設 Focus（程式內 `CURRENT_FOCUS`）與作用窗格等檢視狀態只存在瀏覽器。

### Focus 顯示與開啟規則

URL 的 `focus` 參數指定顯示的 Focus；沒有時，`useNoteFocus` 在 render 時改用該筆記本上次顯示的 Focus（`view.last`），沒有就用預設 Focus，不把它寫回 URL，避免先畫出瀏覽區再跳成 Focus。URL 指定的 Focus 已不存在時同樣改顯示預設。
不要用 effect 補寫 URL 來決定畫面；react-router 與 nuqs 的更新都包在 `startTransition`，`useLayoutEffect` 也擋不住中間畫面。
預設 Focus 不能關閉，只能清除（`clear`）：清成單一空窗格，立即清除；具名 Focus 可以關閉，關閉與刪除後都顯示預設，清除則先確認。偏好設定不再有 `defaultFocusMode`，舊清單留著該鍵仍可載入，儲存時不會寫回。
窗格內點選的 `[[link]]` 開在同一窗格的 tab；河道卡片開在最近使用的另一窗格，只有一個窗格時，桌面改為向右分割出新窗格；瀏覽區點選開在作用窗格。
拖放到窗格主體的邊緣四分之一分割該窗格，中央與 tab 列則加入或搬動 tab；平板與手機只顯示部分窗格，不分割，只在中央與 tab 列放下。
關閉窗格的最後一個 tab、或把它搬走，窗格就移除；清掉已不存在的筆記（`pruneFocus`）不移除窗格，避免筆記還在載入時窗格消失。
平板顯示根分割的第一個子節點與其餘各窗格，手機把所有窗格併成一個顯示窗格；這只是顯示，不改檔案。

### 工作區文件

學習資料與 Focus 配置登錄在 `packages/core/src/workspace-documents.ts`，登錄決定可提交的範圍、大小上限、格式驗證，以及搬移筆記或資料夾時如何更新參照。
登錄可附 `write`，把記憶體中的值轉成要存的版本（Focus 用它維持 version 1 寫入）；存檔一律經 `serializeWorkspaceDocument(document, value)`。
新增工作區根目錄的使用者檔案時，加入登錄與上述所有權清單（`scripts/lib/workspace-conversion.mjs`）。
