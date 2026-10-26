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
路徑所在的筆記本擁有合輯，檔案不重複 `notebookId`；項目與動態來源必須指向同一筆記本（YouTube 項目除外）。
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
