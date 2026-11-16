# 部署 MyGitNotes

[English](deploy.md) · [繁體中文](deploy.zh-TW.md)

先依 [快速開始](../README.zh-TW.md#快速開始) 在本機跑起來，再選擇符合 hosting 設定的部署方式。

## 透過 GitHub Actions sparse checkout 部署至 Vercel（預設）

### Vercel 部署準備

**帳號與服務**

- Vercel 專案、含 core 與 main 分支的 GitHub 儲存庫，以及 Upstash Redis database。
- 使用 GitHub 登入時，準備 GitHub OAuth App，並將 OAuth callback 設為 `https://<your-project>.vercel.app/api/auth/github/callback`。
- 使用 GitLab 登入時，準備 [GitLab 來源設定](#gitlab-來源設定) 所述的 GitLab OAuth App。使用 GitHub Enterprise 時，依 [GitHub Enterprise 來源設定](#github-enterprise-來源設定) 在該站台註冊 App。

**要產生的值**

- 在第一個階段前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。
- 在第一個階段前於 Vercel Account Settings → Tokens 建立 `VERCEL_TOKEN`，Scope 設為擁有此專案的 team，並留存 token。

**要安裝的工具**

- 安裝 Vercel 與 GitHub CLI。

### 設定 runtime values

1. 登入 Vercel CLI：`vercel login`
2. 登入 GitHub CLI：`gh auth login`
3. 在 Core checkout 連結 Vercel 專案：`vercel link`。從產生的 .vercel/project.json 讀取 [連接 GitHub Actions 階段](#連接-github-actions) 所需的 orgId 與 projectId。
4. 複製環境範本：`cp .env.example .env`
5. 填寫下方 .env 執行期欄位，使用工作區儲存庫與 main branch，以及 [Vercel 部署準備](#vercel-部署準備) 提供的 callback、`SESSION_SECRET` 和 Upstash Redis REST URL、token。
6. 將欄位匯入 Vercel production：`pnpm env:vercel production`

~~~bash
MYGITNOTES_SOURCE=github
MYGITNOTES_REPOSITORY=owner/workspace-repo
MYGITNOTES_BRANCH=main
APP_URL=https://<your-project>.vercel.app
GITHUB_CLIENT_ID=your_oauth_client_id
GITHUB_CLIENT_SECRET=your_oauth_client_secret
GITHUB_APP_TYPE=oauth-app
SESSION_SECRET=<output of openssl rand -hex 32>
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
~~~

### 連接 GitHub Actions

1. 在 Vercel 開啟「**Settings → Git**」並中斷 Git integration，避免同時觸發完整儲存庫部署。
2. 設定 gh 預設 GitHub 儲存庫為含有此 workflow 的儲存庫，將 OWNER/WORKSPACE_REPO 換成其擁有者與名稱：`gh repo set-default OWNER/WORKSPACE_REPO`
3. 將準備好的 `VERCEL_TOKEN` 設為 GitHub Actions secret：`gh secret set VERCEL_TOKEN`（出現提示時貼上 token）
4. 將 ORG_ID 換成[連結步驟](#設定-runtime-values)取得的 orgId，再設為 GitHub Actions variable：`gh variable set VERCEL_ORG_ID --body ORG_ID`
5. 將 PROJECT_ID 換成[連結步驟](#設定-runtime-values)取得的 projectId，再設為 GitHub Actions variable：`gh variable set VERCEL_PROJECT_ID --body PROJECT_ID`

### 部署與驗證

1. 從 core 執行 production workflow：`gh workflow run deploy-vercel-sparse.yml --ref core`
2. 用 `gh run watch` 等待完成；再以 `vercel ls --prod` 確認部署為 Ready，並開啟網域確認筆記檢視正常。

workflow 從 core 部署產品路徑；main 的筆記異動不會觸發 build，app 會在執行期從 main 讀取工作區內容。workflow 預設從 core 部署；只有改用其他 deploy branch 時才設定 `MYGITNOTES_DEPLOY_BRANCH` repository variable。多個部署共用同一個 Redis database 時才設定 `MYGITNOTES_SESSION_NAMESPACE`，且每個部署使用不同值。

### 替代方案：透過 Vercel Git integration 部署（停用 Actions 部署）

**帳號與服務**

- 完成[設定 runtime values 階段](#設定-runtime-values)，包括 CLI 登入、連結 Vercel 專案、GitHub OAuth App、Upstash Redis 與執行期欄位。
- 保持 Vercel Git integration 連線，並將 Vercel production branch 設為 core。

**要產生的值**

- 略過[準備階段](#vercel-部署準備)中的 `VERCEL_TOKEN` 設定。

**要安裝的工具**

- 使用預設 Vercel 路徑的 Vercel 與 GitHub CLI。

1. 在 GitHub 設定 workflow 停用變數：`gh variable set MYGITNOTES_VERCEL_DEPLOY --body git-integration`
2. 讓 Vercel 透過 corepack 使用 package.json 指定的 pnpm（12）建置；只看 lockfile 的話它會挑 pnpm 9 或 10：`vercel env add ENABLE_EXPERIMENTAL_COREPACK production --value 1`
3. 在 Vercel「**Settings → Git**」確認 production branch 為 core；vercel.json 已允許從 core 部署。
4. 在 Vercel「**Deployments**」確認最新的 core 部署狀態為 Ready，並開啟網域確認筆記檢視正常。

此路徑會由 Vercel 複製完整儲存庫，不需要 `VERCEL_TOKEN`、`VERCEL_ORG_ID` 或 `VERCEL_PROJECT_ID`。

## 輕量 Vercel 部署（不用 Redis，訪客自選儲存庫）

這條路徑不需要 Redis，也不需要固定的筆記儲存庫。
每位訪客透過 GitHub 登入後，從自己的儲存庫中選一個來使用。
登入狀態（包括 GitHub token）和選定的儲存庫都以 `SESSION_SECRET` 加密，存在 HttpOnly cookie，伺服器不保存任何資料。
沒有 MyGitNotes manifest 的儲存庫會以頂層資料夾作為筆記本開啟，並提示可以 commit 一份 manifest。

伺服器不保存資料，代價如下：沒有 MCP 連線授權、不支援 GitLab 登入、沒有 Core 更新面板；GitHub App 的 refresh token 到期（六個月）或更新失敗後，需要重新登入。

### 輕量部署準備

**帳號與服務**

- 依 [Vercel 部署準備](#vercel-部署準備) 建立 Vercel 專案，不需要 Upstash Redis。
- 建立 GitHub App（**Settings → Developer settings → GitHub Apps → New GitHub App**）：
  - Homepage URL 設為 `APP_URL`，Callback URL 設為 `APP_URL`/api/auth/github/callback。
  - 保持開啟 **Expire user authorization tokens**，並開啟 **Request user authorization (OAuth) during installation**。
  - 關閉 **Webhook**。
  - Repository permissions：**Contents** 設為 Read and write，**Metadata** 設為 Read-only。
  - 安裝範圍選 **Any account**，讓訪客能安裝到自己的儲存庫。
  - 產生 client secret，記下 client ID 與 App 的網址名稱（`https://github.com/apps/<slug>` 中的 slug）。

**要產生的值**

- 以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。
  更換這個值會讓所有訪客登出，也會清掉他們選過的儲存庫。

### 輕量部署的 runtime values

在 .env 填入下列欄位，再以 `pnpm env:vercel production` 匯入；`MYGITNOTES_REPOSITORY`、`MYGITNOTES_BRANCH` 與所有 Redis 變數都不要設定。

```dotenv
APP_URL=https://<your-project>.vercel.app
MYGITNOTES_SOURCE=github
GITHUB_APP_TYPE=github-app
GITHUB_APP_SLUG=<GitHub App 的網址名稱>
GITHUB_CLIENT_ID=<GitHub App 的 client ID>
GITHUB_CLIENT_SECRET=<GitHub App 的 client secret>
SESSION_SECRET=<openssl rand -hex 32 的輸出>
```

依 [連接 GitHub Actions](#連接-github-actions) 與 [部署與驗證](#部署與驗證) 部署後開啟網域：先出現登入畫面，登入後出現儲存庫選擇畫面。

沒有筆記儲存庫的訪客，可在選擇畫面按「建立新的筆記 repository」：會開啟已預填範本的 GitHub 新儲存庫頁面，建立並授權給 App 後，選擇畫面會自動選取它。
範本預設為公開的 [`MyGitNotes/mygitnotes-starter`](https://github.com/MyGitNotes/mygitnotes-starter)；設定 `MYGITNOTES_STARTER_TEMPLATE=<owner>/<name>` 可改用你自己的範本儲存庫。

任何部署都能以 `MYGITNOTES_STORAGE=cookie` 改用 cookie session；Vercel 在沒有設定 Redis 時會自動使用。
有設定 `MYGITNOTES_REPOSITORY` 的部署仍固定使用該儲存庫，有沒有 Redis 都一樣。

## Docker Compose 連接遠端儲存庫

### Docker Compose 部署準備

**帳號與服務**

- 安裝 Docker 與 Compose，準備公開網址或 http://localhost:4321。Compose 會在內部網路啟動 Redis，不需要 Redis 帳號。
- 使用 GitHub 登入時建立 GitHub OAuth App，將 Homepage 設為 `APP_URL`，callback 設為 `APP_URL`/api/auth/github/callback。
- 使用 GitLab 登入時，使用 [GitLab 來源設定](#gitlab-來源設定)。

**要產生的值**

- 在[Docker Compose 部署](#docker-compose-連接遠端儲存庫)前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。

**要安裝的工具**

- 安裝 Docker 與 Compose。

1. 複製環境範本：`cp docker.env.example .env.docker`
2. 在 .env.docker 設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=owner/repo`、`MYGITNOTES_BRANCH=main`、`APP_URL`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 與 `GITHUB_APP_TYPE=oauth-app`。
3. 將準備步驟產生的值填入 `SESSION_SECRET`。
4. 檢查 Compose 展開後的設定：`docker compose -f compose.yaml config --quiet`
5. 建置並啟動 MyGitNotes 與 Redis：`docker compose -f compose.yaml up -d --build`
6. 開啟 `APP_URL` 驗收：筆記檢視成功載入，GitHub 登入會前往環境設定階段指定的 OAuth App。

Compose 預設將 app 發布於 127.0.0.1:4321，並以 redis-data volume 保存 Redis 資料。若要更換瀏覽器使用的連接埠，設定 `MYGITNOTES_PORT`，並將相同網址填入 `APP_URL`。

更新產品 checkout 後，執行 `docker compose up -d --build` 重新建置。`docker compose down` 會保留 Redis volume；`docker compose down -v` 會刪除 volume，使已存 session 與 MCP 授權失效。

## Docker 連接遠端儲存庫

### Docker 部署準備

**帳號與服務**

- 安裝 Docker，設定 `APP_URL` 為 http://localhost:4321 或公開 HTTPS 網址，並準備保存加密 session 與 MCP 授權的持久 Docker volume。
- 使用 GitHub 登入時，將 OAuth App 的 Homepage 設為 `APP_URL`，callback 設為 `APP_URL`/api/auth/github/callback。
- 使用 GitLab 登入時，使用 [GitLab 來源設定](#gitlab-來源設定)。

**要產生的值**

- 在[Docker 部署](#docker-連接遠端儲存庫)前以 `openssl rand -hex 32` 產生 `SESSION_SECRET`。

**要安裝的工具**

- 安裝 Docker。

1. 複製環境範本：`cp docker.env.example .env.docker`
2. 在 .env.docker 設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=owner/repo`、`MYGITNOTES_BRANCH=main`、`APP_URL`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 與 `GITHUB_APP_TYPE=oauth-app`；只有使用自有 Redis 時才在此設定 `REDIS_URL`。
3. 將準備步驟產生的值填入 `SESSION_SECRET`。
4. 建置 image：`docker build -t mygitnotes:local .`
5. 建立持久 session 儲存空間：`docker volume create mygitnotes-sessions`
6. 啟動容器：
   `docker run -d --name mygitnotes --init --restart unless-stopped -p 127.0.0.1:4321:4321 --env-file .env.docker --mount type=volume,source=mygitnotes-sessions,target=/app/.github-notes-sessions mygitnotes:local`
7. 開啟 `APP_URL` 驗收：筆記檢視成功載入，GitHub 登入會前往環境設定階段指定的 OAuth App。

[建立持久 session 儲存空間的步驟](#docker-連接遠端儲存庫)所建立的 volume，會在更換容器後保留 session、provider 憑證與 MCP 授權。若在環境設定中設定 `REDIS_URL`，Native Redis 優先於 Redis REST。

## 公開連線：使用 reverse proxy

本小節同時適用於 [Docker Compose](#docker-compose-連接遠端儲存庫) 與 [Docker](#docker-連接遠端儲存庫)。將 `APP_URL` 設為 HTTPS 網址，並把 reverse proxy 指向 127.0.0.1:4321。保留 public Host header，轉送 /api/*、/mcp/*、/raw-assets/* 與 /r2-assets/*，並允許 streamed MCP responses。若 proxy 在另一個容器，兩者須共用 app network，並轉送至 mygitnotes:4321。

## 在容器中開啟本機 checkout

### 容器內 checkout 準備

**帳號與服務**

- 位於 main、含 .mygitnotes.yaml 與筆記的既有工作區 checkout。Linux 上請讓 UID/GID 1000:1000 可讀寫該 checkout。

**要產生的值**

- 無。

**要安裝的工具**

- Docker 與 Git。

1. 將 `WORKSPACE_PATH` 設為工作區絕對路徑：`export WORKSPACE_PATH=/absolute/path/to/workspace`
2. 設定工作區 commit 作者：`git -C "$WORKSPACE_PATH" config user.name "Your Name"`
3. 設定工作區 commit email：`git -C "$WORKSPACE_PATH" config user.email you@example.com`
4. 檢查 bind mount 與 Compose 設定：`docker compose -f compose.local.yaml config --quiet`
5. 建置並啟動容器：`docker compose -f compose.local.yaml up -d --build`
6. 開啟 http://localhost:4321 驗收：掛載的工作區會出現在筆記檢視。

此模式是限於 loopback host 的匿名桌面流程。編輯內容與 Screen／Study YAML 會保存在掛載的 checkout。若要 commit 與同步，請在該 checkout 設定遠端 Git 憑證。

## GitLab 來源設定

本小節可套用在 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設)、[Docker Compose](#docker-compose-連接遠端儲存庫) 或 [Docker](#docker-連接遠端儲存庫) 之上。

### GitLab 來源準備

**帳號與服務**

- 在所選 GitLab 站台建立 OAuth application，使用 api scope，callback 為 `APP_URL`/api/auth/gitlab/callback。
- 自架 GitLab 請填 HTTPS 站台網址，若安裝於子路徑也要包含該路徑；部署環境需能連線並信任該站台。
- 保留所選基礎路徑的 `APP_URL`、`SESSION_SECRET` 與 session 儲存設定。

**要產生的值**

- 除所選基礎路徑的值之外，無其他值。

**要安裝的工具**

- 使用所選基礎路徑的工具。

1. 在 .env.docker（Docker）或 .env（Vercel）設定 `MYGITNOTES_SOURCE=gitlab`、`MYGITNOTES_REPOSITORY=group/subgroup/project`、`MYGITNOTES_BRANCH=main`、`MYGITNOTES_GITLAB_URL=https://gitlab.com`、`GITLAB_CLIENT_ID` 與 `GITLAB_CLIENT_SECRET`。
2. Vercel 請執行 `pnpm env:vercel production` 匯入更新後的 .env 欄位；Docker 使用來源設定階段編輯的 .env.docker。
3. Compose 從建置與啟動步驟接續；Docker 從 image 建置與容器啟動步驟接續；Vercel 執行 `gh workflow run deploy-vercel-sparse.yml --ref core`。
4. 開啟 `APP_URL` 驗收：GitLab 登入會連往準備階段建立的 OAuth application，筆記檢視成功載入。

使用 Actions 部署時，保留 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設) 的 GitHub 部署設定，只替換筆記來源與 OAuth provider 欄位。GitLab 寫入需要 main 的 push 權限；公開儲存庫支援匿名讀取。

## GitHub Enterprise 來源設定

本節疊加在 [Vercel sparse checkout 部署](#透過-github-actions-sparse-checkout-部署至-vercel預設)、[Docker Compose](#docker-compose-連接遠端儲存庫) 或 [Docker](#docker-連接遠端儲存庫) 之上，讓筆記放在 GitHub Enterprise Server（GHES）或 GitHub Enterprise Cloud 資料落地（GHE.com）的儲存庫，而不是 github.com。

### GitHub Enterprise 來源準備

**帳號與服務**

- 在同一個 Enterprise 站台註冊 GitHub OAuth App 或 GitHub App，callback 為 `APP_URL`/api/auth/github/callback。不支援個人存取權杖（PAT）登入。
- 確認部署環境能以 HTTPS 連線並信任該站台，API 也要連得到：GHES 為 `https://<站台>/api/v3`，GHE.com 為 `https://api.<主機>`。
- `APP_URL`、`SESSION_SECRET` 與 session 儲存沿用所選基礎路徑。

**需要產生的值**

- 除了所選基礎路徑已有的值，不需要其他值。

**需要安裝的工具**

- 沿用所選基礎路徑的工具。

1. 在 .env.docker（Docker）或 .env（Vercel）設定 `MYGITNOTES_SOURCE=github`、`MYGITNOTES_REPOSITORY=team/notes`、`MYGITNOTES_BRANCH=main`、`MYGITNOTES_GITHUB_URL=https://ghe.example.com`（GHE.com 為 `https://octocorp.ghe.com`，安裝在子路徑也可以），以及該站台上註冊之 App 的 `GITHUB_CLIENT_ID` 與 `GITHUB_CLIENT_SECRET`。`GITHUB_NOTES_GITHUB_URL` 同樣會被讀取。只有 `MYGITNOTES_SOURCE=github` 時才讀這個設定；留空或填 `https://github.com`，行為與 github.com 部署完全相同。
2. Vercel 以 `pnpm env:vercel production` 匯入更新後的 .env 欄位；Docker 使用來源設定步驟的 .env.docker。
3. Compose 接續建置與啟動步驟；單純 Docker 接續映像建置與容器啟動步驟；Vercel 執行 `gh workflow run deploy-vercel-sparse.yml --ref core`。
4. 開啟 `APP_URL`：登入會前往 Enterprise 站台，筆記檢視成功載入。

下列項目都跟著這個站台：儲存庫讀寫、登入、`MYGITNOTES_REPOSITORY` 留空時的儲存庫選擇器、GitHub App 安裝連結（`<站台>/github-apps/<slug>/installations/new`），以及 Gist 發佈（筆記的「開啟 Gist」連結會向站台的 Gist API 查詢網址，再開到那裡）。工作區的每個儲存庫都在部署的站台上；位於其他站台的儲存庫會標成無法使用，因為這個站台的登入碰不到它。

舊版會忽略 `github` 來源上的 `url`。現在 manifest 或 server YAML 裡帶了 `url`，就代表那個站台；github.com 的來源若殘留 `url`（例如填了儲存庫的網頁網址），請刪掉，也不要留空值。

與 github.com 的差異：

- **從範本建立**：github.com 提供入門範本。Enterprise 站台只有在 `MYGITNOTES_STARTER_TEMPLATE` 指定該站台上的範本時才顯示建立連結；否則請使用者選擇既有儲存庫。
- **Core 更新**仍然追蹤 github.com，產品儲存庫在 Enterprise 站台時不提供，站台的權杖也就不會送到 github.com。
- **封存檔下載**只接受導向該站台自己的 codeload（`https://codeload.<主機>/…`，未啟用子網域隔離時為 `https://<主機>/codeload/…`），必須是 HTTPS，連接埠與站台網址相同（預設連接埠則不帶）。
- Pro 服務仍然只支援 github.com。

## Core 更新

「設定」頁會分別檢查儲存庫的 Core 版本與正在執行的 build。本機更新需要位於 `core` 的乾淨產品 checkout；工作區分支不影響此操作。更新後以新版 Core 執行 `pnpm migrate-workspace`，再重新啟動 server。

線上部署只為它的產品儲存庫提供 Core 更新，也就是它部署的 `core` 分支所在的儲存庫。用 `MYGITNOTES_PRODUCT_REPOSITORY`（`owner/name`）或 `mygitnotes.server.yaml` 的 `product_repository: owner/name` 指定；它在部署的 GitHub 站台上（`MYGITNOTES_GITHUB_URL`，未設定時是 github.com）。fork-model 部署的筆記儲存庫同時帶著 `core`，就指定同一個儲存庫；`pnpm bootstrap-workspace` 會依 GitHub 上的 `origin` 把它寫進 Core checkout 的 .env（已有值則保留），`pnpm env:vercel` 再把它匯入。沒有指定時，「設定」頁不顯示 Core 更新，更新路由直接回 404，不會向 provider 發出請求。

GitHub 工作區在「設定」頁提示缺少 workflow 時，先按 **Install Core sync**，再按 **Update Core**。bootstrap 也會把 [canonical workflow](../packages/core/assets/mygitnotes-core-sync.yml) 安裝到 `main` 的 `.github/workflows/mygitnotes-core-sync.yml`；預設分支不是 `main` 的儲存庫，可透過「設定」頁安裝到該分支。workflow 會抓取 MyGitNotes upstream，並 push `core` 的 fast-forward。「設定」頁會追蹤對應的 run，確認更新後的 revision 才回報成功。既有 workflow 檔案會保留。

GitHub OAuth 需要 `repo workflow gist` scope；`gist` 讓筆記的「資訊」分頁能把本文發佈成 secret Gist。較舊的授權會顯示 **Re-authorize GitHub**，用這類授權發佈時會要求重新登入。app 會加密使用者的授權，存成儲存庫 Actions secret `MYGITNOTES_CORE_SYNC_TOKEN`，供 runner push 使用。能修改該儲存庫 workflow 的人，都能透過 workflow 使用這份憑證。以使用者 token push 會觸發已設定的部署事件；部署完成與 Core sync 完成是兩件事。

GitHub App 安裝需在 App 設定開啟 **Contents**、**Workflows**、**Actions** 與 **Secrets** 的寫入權限；App 登入不會要求 OAuth scope。GitLab 目前不支援 Core 更新，GitLab 登入維持既有的 `api` scope。

## 更新與遷移

在乾淨的 `core` checkout 執行 `pnpm update-core`，將產品分支從 `upstream/core`（沒有 `upstream` remote 時改用 `origin/core`）fast-forward，並遷移已設定的工作區；接著執行 `pnpm install && pnpm dev`，以更新後的 Core 重新啟動。若要單獨遷移工作區，請在該 checkout 執行 `pnpm migrate-workspace`。若 `schema_version` 不相容，local server 會停止，並在錯誤訊息指出 `pnpm migrate-workspace`；若工作區需要較新的 Core，錯誤訊息會指出 `pnpm update-core`。

若舊工作區的 `main` 仍包含產品檔案，先提交或清除變更，再於 `main` 執行一次 `pnpm convert-workspace`。接著以 `git worktree add --track -b core ../mygitnotes-core origin/core` 建立獨立 Core worktree，在其 .env 將 `MYGITNOTES_LOCAL_PATH` 設為轉換後的 checkout，並從 Core worktree 啟動。`pnpm update-core` 僅能在 `core` 執行。

### 線上部署升到 schema 4

這版 Core 的線上部署仍能讀取 schema 3、而且沒有任何筆記本使用 `source` 的 manifest；舊版 Core 則會拒絕 schema 4。所以先部署程式，之後再遷移 manifest，順序如下：

1. 部署前，在部署環境指定產品儲存庫：`MYGITNOTES_PRODUCT_REPOSITORY=owner/name`，或 `mygitnotes.server.yaml` 的 `product_repository`（見 [Core 更新](#core-更新)）。自架的線上部署必須設定它才能保留 Core 更新；沒設定時，「設定」頁不再顯示 Core 更新，更新路由回 404。在 Vercel 上要在部署開始前設好，這次部署才會帶到這個值。
2. 部署新版 Core，等部署上線。
3. 確認瀏覽與提交筆記正常、既有的 MCP 連線仍列得出筆記本、「設定」頁有 Core 更新。
4. 之後再找時間，在筆記儲存庫分支的乾淨 checkout 上，從新版 Core checkout 執行 `pnpm migrate-workspace --workspace <checkout>` 遷移它的 manifest。它會產生 commit `chore: migrate the workspace manifest to schema 4`，內容只改 `schema_version`；用 `git -C <checkout> show --stat HEAD` 確認後再 push。

push 這個 commit 之前，回滾只需要換回舊版程式；push 之後要連同它一起 revert，因為舊版 Core 拒絕 schema 4。仍有筆記本使用 `source` 的 manifest，在這版 Core 會讓所在儲存庫標成無法使用，要先依[轉換 `source` 筆記本](#轉換-source-筆記本)轉換。

## 筆記本放在其他儲存庫

工作區可以提供多個儲存庫的筆記本。每個儲存庫自己的 `.mygitnotes.yaml`（`schema_version: 4`）宣告它保存的筆記本，`root` 和 `assets` 相對於那個儲存庫，並設定儲存庫的標題、開啟時進入的筆記本與偏好設定。部署指定的儲存庫（`MYGITNOTES_REPOSITORY`、`MYGITNOTES_LOCAL_PATH` 或最上層的 `source:`）是預設儲存庫，工作區從這裡開啟。本機部署在 `mygitnotes.server.yaml` 把其他儲存庫對應到 worktree，`path` 相對於這個設定檔；每個儲存庫的分支是它的 worktree 目前 checkout 的分支：

```yaml
repositories:
  - type: github
    repository: owner/trpg-notes
    path: ../trpg-notes
```

線上部署用同樣的方式列出其他儲存庫，不寫 `path`，每個儲存庫要寫 `branch`。這些儲存庫必須和部署在同一個平台與站台；寫了其他平台或站台的項目屬於設定錯誤，錯誤訊息會指出是第幾筆。線上部署任何 GitHub 帳號都能登入，所以每個可見成員的名稱，包括私有儲存庫，任何登入的人都看得到；沒登入的訪客只會看到 provider 允許他讀取的儲存庫。要讓訪客看不到某個儲存庫的名稱，在那筆項目加上 `hidden: true`：

```yaml
repositories:
  - type: github
    repository: owner/private-journal
    branch: main
    hidden: true
```

連不上的儲存庫、或 manifest 無法載入的儲存庫，會標成無法使用並顯示原因，其他儲存庫照常運作；「設定」頁會開啟有問題的 manifest 讓人修正。每個儲存庫各自保存 Screen、Focus、Study 設定檔和 Agent 檔案；跨儲存庫的提交會在每個儲存庫各產生一個 commit。

### 轉換 `source` 筆記本

schema 3 允許主 manifest 用 `source` 宣告其他儲存庫的筆記本。schema 4 移除了 `source`；仍使用它的 manifest 會讓所在儲存庫標成無法使用，原因是 `Notebook <id> uses source, which schema 4 removed. Run pnpm convert-sources in <repository>.`。請在 Core checkout 執行一次轉換，它的 `mygitnotes.server.yaml` 要把每個被指定的儲存庫對應到 worktree：

```sh
pnpm convert-sources            # 顯示計畫；在終端機中寫入前會先詢問
pnpm convert-sources --yes      # 不詢問，直接套用
pnpm convert-sources --workspace ../hub --yes   # 轉換另一個已對應 worktree 的 manifest
```

每個帶 `source` 的筆記本，會原樣（只拿掉 `source`）加進它指定的儲存庫的 manifest。那個儲存庫沒有 manifest 時會新建一份：標題是儲存庫名稱，開啟時進入第一個移入的筆記本，偏好設定複製自轉換中的 manifest，寫入前會完整顯示；已有的 manifest 則保留原本的標題、預設筆記本與偏好設定。接著把筆記本從轉換中的 manifest 移除，兩邊都改成 `schema_version: 4`。以下情況會在寫入任何檔案前拒絕：被指定的儲存庫沒有對應的 worktree、目標已有同 id 但內容不同的筆記本或 root 重疊的筆記本、要改的 manifest 有未提交的變更。轉換中的 manifest 開啟時進入的筆記本被移走時，計畫會列出原本與新的 `default_notebook`（剩下的第一個筆記本）。轉換中的儲存庫的 Focus 與 Study 檔若有被移走筆記本的項目，會列出來並留在原處。

轉換部署本身的來源時，每個儲存庫的 alias 也會維持不變；alias 是它的筆記本在網址與 Focus 版面裡的 key 開頭。schema 3 依 manifest 的筆記本以 `source` 指定儲存庫的順序產生 alias，這版 Core 則依 `repositories` 的順序產生，所以指令會把筆記本要移入的儲存庫依那個順序排到 `repositories` 最前面，其他項目維持原順序排在後面；計畫會列出新的順序與轉換後的 alias。

每個儲存庫的變更各是一個 commit。commit 失敗時指令會停下，並印出提交已寫入檔案的指令；提交後再執行一次 `pnpm convert-sources`，已經以相同內容存在於目標儲存庫的筆記本會略過。再次執行時若發現這類 manifest 仍未提交，指令會在提交其他儲存庫前停下，並再印一次那個提交指令。所有筆記本都會離開轉換中的 manifest 時，指令會停下，除非加上 `--remove-emptied`：它在該儲存庫的 commit 裡刪除那份 manifest，並把該儲存庫從 `mygitnotes.server.yaml` 的 `repositories` 移除；部署本身的來源不能這樣移除，要先換成其他儲存庫。沒有 `source` 的 manifest 用 `pnpm migrate-workspace` 升到 schema 4。低於 schema 3 的 manifest 可能還有只有 schema 3 Core 才會轉換的 Screen 檔：`convert-sources` 會拒絕它，請先在 `fd0fd42` 的 Core checkout 執行 `pnpm migrate-workspace`。

## 選用：透過自己的 Pi bridge 使用 Agent 面板

遠端部署預設沒有 Agent 面板。你可以在自己掌控的機器（你的伺服器或電腦，需要能用 HTTPS 連到，例如透過 tunnel）上執行 Pi bridge，讓你列出的人從部署的面板使用它。Bridge 用你的供應商金鑰執行 Pi，部署只負責轉送 session 呼叫，並讓瀏覽器連到 bridge。

給非開發者的逐步指南是[讓 Agent 面板使用你自己電腦上的 Pi](pi-bridge.zh-TW.md)。簡單來說，在執行 Pi 的機器上安裝 Pi，執行 `npx mygitnotes-pi-bridge --tunnel`，它會印出配對碼，把它設成部署的 `MYGITNOTES_EXTERNAL_PI_PAIRING` 環境變數。部署的頁面必須被 bridge 允許，所以指令要加上 `--origin <你的部署的 origin>`。

在部署上設定：

| 變數 | 說明 |
| --- | --- |
| `MYGITNOTES_EXTERNAL_PI_PAIRING` | 配對碼（`mgnpi1.…`），內含 bridge 的網址與 secret。用它就不必設下面兩個變數；同時設定其中任何一個會報錯。 |
| `MYGITNOTES_EXTERNAL_PI_URL` | 部署連到 bridge 的網址，通常與 `MYGITNOTES_BRIDGE_PUBLIC_URL` 相同。 |
| `MYGITNOTES_EXTERNAL_PI_SECRET` | 與 `MYGITNOTES_BRIDGE_SECRET` 相同的值。 |
| `MYGITNOTES_EXTERNAL_PI_OWNERS` | 以逗號分隔、可以使用 Agent 的登入帳號，或用 `id:<供應商使用者 id>` 避免改名失效，例如 `octocat,id:12345`。它們指的是部署目前登入供應商（GitHub 或 GitLab 站台）上的人；其他供應商的 session，或主站視為已登出的 session，一律不通過。 |

兩者都沒設定時，什麼都不會改變。沒有列出的已登入使用者看不到 Agent。Bridge 的環境變數、安全性與疑難排解請看[指南](pi-bridge.zh-TW.md)。

## 選用：外部即時編輯器

版本（edition）可以把外部的即時（共同）編輯器接到遠端儲存庫上；社群版本身不附任何編輯器。接上之後，在 Markdown 筆記按「編輯」會把它簽出到編輯器（有權限寫入的人打開筆記網址加上 `?edit`，例如 `<筆記網址>?edit`，效果相同），之後每晚自動簽回 Git，有人按「立即簽回」時也會立即簽回。簽回會提交即時文字並列出每位編輯者（最早的一位是作者，其他人寫成 `Co-authored-by`），合併期間 Git 上的變更；兩邊改到同一處時以即時文字為準，並在提交訊息中註明。CRLF 換行的筆記在第一次簽回時改成 LF，那一次提交會改寫每一行的行尾。

| 變數 | 意義 |
| --- | --- |
| `MYGITNOTES_LIVE_CHECKIN_AT` | 每晚簽回的時間，`HH:mm`，以 `MYGITNOTES_TIMEZONE` 的時區計（預設 `03:00`；沒設時區時為 UTC）。設為 `off` 關閉程序內排程。不是時間的值會讓伺服器啟動失敗。 |
| `MYGITNOTES_LIVE_SWEEP_SECRET` | 至少 32 字元的隨機密鑰，啟用給外部觸發用的 `POST /api/live/sweep`。沒設時這個路由回 404。 |

長時間執行的伺服器（Docker、Node）會自己在這個時間、以及之後 10、20、30 分鐘（給當時還有人在編輯的筆記）各簽回一次，啟動後一兩分鐘內也會補跑一次，補上停機期間錯過的簽回。Vercel 的函式不會常駐，所以那裡不跑排程：請用 Vercel Cron、Nomad periodic job 或 cron 呼叫簽回路由。路由回 202 後繼續在背景執行；加上 `?wait=1` 會等跑完再回報告。

```sh
curl -fsS -X POST -H "Authorization: Bearer $MYGITNOTES_LIVE_SWEEP_SECRET" https://notes.example.com/api/live/sweep
```

多程序部署的每個程序都可以跑排程和這個路由：編輯器的租約讓同一則筆記一次只有一個簽回在跑，重複執行時會發現文字已在 Git 裡，不會再提交第二次。

## 選用：內建即時編輯器

社群版也附了自己的即時編輯器。多人直接在 MyGitNotes 自己的編輯器裡共同編輯一則筆記，看得到彼此打的字與標上名字的游標，簽回方式與上一節相同。打字經由 App 自己伺服器上的 WebSocket（`/live/socket`）傳送，兩次簽回之間的內容存在 Redis。

0.20.0 沒有可以開啟它的環境變數，伺服器進入點（Docker 映像執行的那個）也不會啟動它。簽回要用寫入憑證提交，並以驗證過的 email 列出編輯者，而社群版部署兩者都沒有：使用者用自己的平台 token 登入，這個 token 不會活過單次請求，預設的登入方式也不提供驗證過的 email。兩者都有的部署，在自己的伺服器進入點用 `@mygitnotes/local-server` 的 `builtinLiveNotes` 組裝。`open` 回傳帶著部署自己寫入憑證的儲存庫，提交的作者是傳入的 author：

```ts
import { builtinLiveNotes, createApp, redisLiveStore } from '@mygitnotes/local-server';

const live = builtinLiveNotes({ covers, open, store: redisLiveStore({ url: process.env.REDIS_URL! }) });
await live.started; // 拒絕可能淘汰即時文字的 Redis
const app = createApp(base, { liveNotes: live /* 以及部署的其他服務 */ });
const server = app.listen(port, host);
server.on('upgrade', (req, socket, head) => { if (!live.upgrade(req, socket, head)) socket.destroy(); });
process.once('SIGTERM', async () => { await live.shutdown(); server.close(); });
```

伺服器需要：

- **長時間執行、支援 WebSocket 的 Node 22 以上伺服器。** 不能跑在 Vercel：設了 `VERCEL` 時，`createApp` 會在啟動時停下。
- **`APP_URL` 設為瀏覽器看到的來源**，不帶路徑的 `https` origin，例如 `https://notes.example.com`（只有 loopback 主機可用 `http`）。socket 只接受這個 `Origin`，沒設時伺服器不會啟動。
- **單一 Redis 伺服器（不是 cluster）**，透過 `REDIS_URL`（`redis://` 或 `rediss://`；不支援 Redis REST）。設定 `maxmemory-policy noeviction`（建議）或 `volatile-*` 策略，並開 `appendonly yes`。即時文字沒有到期時間，所以 `volatile-*` 不會淘汰它；在 `allkeys-*` 策略下伺服器拒絕啟動，因為 Redis 可能丟掉打到一半的字。讀不到策略時（有些代管服務不公開），伺服器發出警告後照常啟動。沒有 append-only file 時，它會警告 Redis 重啟會丟掉上次簽回後打的字。和 session 共用同一個 Redis 沒有問題，它的 key 會依 `MYGITNOTES_SESSION_NAMESPACE` 分開。
- **只跑一個 App 程序。** 部署交替時短暫有兩個程序仍然正確、不會丟字，但連到不同程序的人要每幾秒才看得到彼此打的字。
- **reverse proxy 要轉送 `/live/socket` 的 WebSocket upgrade**，閒置逾時不能低於 60 秒；伺服器每 30 秒 ping 一次。Caddy 的 `reverse_proxy` 預設就會轉送。nginx 需要：

  ```nginx
  location /live/ {
    proxy_pass http://127.0.0.1:4321;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
  }
  ```

  瀏覽器用 HTTP/1.1 開 socket，不必改 ALPN。

  還沒開啟筆記的 socket，伺服器最多保留 100 個，同一個位址最多 10 個，超過就回 503。從主機或私有網路上的 proxy（loopback、10/8、172.16/12、192.168/16、fc00::/7）連進來時，`X-Forwarded-For` 的最後一筆就是用戶端位址；Caddy 預設會設定。沒有這個標頭時，proxy 後面的所有用戶端都算同一個位址。伺服器只信任直接在 app 前面的那一層 proxy，只讀最後一筆；去掉 `:port` 或 `[...]` 後不是 IP 位址的值一律不算，改用連線來源位址。如果那層 proxy 前面還有 CDN，最後一筆會是 CDN 節點的位址：要讓主機上的 proxy 把 CDN 的用戶端 IP 標頭轉成 `X-Forwarded-For`（nginx 用 `real_ip_header` 加上 CDN 網段的 `set_real_ip_from`，再設 `proxy_set_header X-Forwarded-For $remote_addr`）。不要讓其他容器或區網用戶端直接連 app：來自私有位址的標頭會被採信。
- **記憶體**：每則開著的筆記約需它文字大小的幾倍；50 則 50 KiB 的筆記在數十 MiB 以內。每則筆記的即時文字上限是 5 MiB。

用 `memoryLiveStore()` 取代 `redisLiveStore` 時，即時文字只存在程序裡，每次重啟都會不見，只適合單人試用。

`MYGITNOTES_LIVE_CHECKIN_AT`、`MYGITNOTES_TIMEZONE` 與 `MYGITNOTES_LIVE_SWEEP_SECRET` 的用法與外部編輯器相同。維護前，或把儲存庫從外部編輯器換成內建編輯器之前，先把所有即時筆記立即簽回：

```sh
curl -fsS -X POST -H "Authorization: Bearer $MYGITNOTES_LIVE_SWEEP_SECRET" "https://notes.example.com/api/live/sweep?mode=all&wait=1"
```

用內建編輯器時，留白的新筆記會被捨棄，不會歸檔進 Git：有人對它按「立即簽回」、每晚簽回時，或按「捨棄草稿」時都是如此。扣掉建立時就有的文字（或預設的標題與提示行）之後，如果沒有任何文字、數字、圖片或嵌入，就算留白。還沒歸檔的筆記也可以在第一次簽回前移動或改名；這只改它之後要歸檔的位置，不會提交。

## 選用：私有 R2 素材

將大型檔案存放在 Cloudflare 私有 R2 bucket，並在筆記中以 `r2:<object-key>` 引用。於部署環境設定 `MYGITNOTES_R2_ACCOUNT_ID`、`MYGITNOTES_R2_ACCESS_KEY_ID`、`MYGITNOTES_R2_SECRET_ACCESS_KEY` 與 `MYGITNOTES_R2_BUCKET`。其他相容 S3 的服務（SeaweedFS、MinIO 等）用 `MYGITNOTES_R2_ENDPOINT` 指定其網址，以 `<endpoint>/<bucket>/<key>` 的路徑形式存取，這時不需要 account id。`MYGITNOTES_R2_REGION` 設定簽章用的 region，未設時為 R2 要求的 `auto`；許多相容 S3 的服務要求 `us-east-1`。瀏覽器上傳還需要 bucket CORS 允許來自 `APP_URL` 的 PUT、GET 與 HEAD。唯讀 token 可預覽素材；檔案頁管理功能需要 Object Read & Write。參考 [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) 與 [R2 object access](https://developers.cloudflare.com/r2/api/s3/api/)。

### 本機 checkout 的私有 R2 素材

本機工作區（`pnpm dev` 或本機 Docker）會把筆記引用的私有物件存進快取資料夾，之後從快取顯示，離線時筆記的圖片也看得到。儲存服務可以是 Cloudflare R2，也可以是 `MYGITNOTES_R2_ENDPOINT` 指定的任何 S3 相容 bucket。

筆記第一次顯示某個 `r2:` 物件時，本機伺服器讀取一次並存檔；之後直接從磁碟回應，不再向 bucket 發出請求。第一次顯示時只快取 64 MiB 以內的物件，更大的物件照舊轉址到 bucket。要事先抓好全部物件（不限大小），執行下載指令：

```bash
pnpm r2-download                                  # 所有筆記本的所有筆記
pnpm r2-download --notebook research              # 單一筆記本（可重複指定）
pnpm r2-download --note notes/research/paper.md   # 單一筆記（可重複指定）
pnpm r2-download --note notes/research/paper.md --out ~/Desktop/paper-files   # 另外把物件依 key 複製到資料夾
pnpm r2-download --refresh                        # 重新讀取所有被引用的物件
```

指令只下載筆記內文引用的 key，快取已有的物件不會重讀；有物件抓不到時，指令列出每一個並以結束碼 1 結束。`--out` 寫入 `<資料夾>/<object-key>`，不會寫到該資料夾以外。

指令與本機伺服器從下列兩種來源之一讀取物件，在 checkout 的 `.env` 設定：

- **Bucket 金鑰。** 與部署環境相同的 `MYGITNOTES_R2_*` 變數，唯讀金鑰即可。
- **Hosted 部署，不需要 bucket 金鑰。** 把 `MYGITNOTES_R2_REMOTE_URL` 設為部署網址（`https://notes.example.com`），`MYGITNOTES_R2_REMOTE_TOKEN` 設為 agent token：在 hosted 網站開啟「設定 → MCP 存取控制」，建立唯讀授權，複製它顯示的 connector URL 中 `/mcp/` 之後的那一段。部署只對它自己那份筆記引用的 key 回傳短效下載網址，所以筆記新引用的物件要先 push 筆記再下載。Token 只送給該部署（必須是 `https`），不會送給 bucket，也不會寫進快取或任何 log。該部署的版本必須已有 `download_assets` MCP 工具。

兩者都設定時使用 bucket 金鑰。

快取位於 checkout 的 `.cache/r2-assets`，Git、`.vercelignore` 與 `.dockerignore` 都排除這個資料夾；`MYGITNOTES_R2_CACHE_DIR` 可以指定其他資料夾（在容器中請指向掛載的 volume，快取才不會隨容器消失）。每個物件是一個以 key 的 SHA-256 命名的檔案，旁邊的 `.json` 檔記錄 key、大小與 entity tag。快取沒有大小上限，且只對應一個 bucket：要釋放空間，或 checkout 改指向另一個 bucket 時，刪除這個資料夾。已快取的物件不會再向 bucket 比對；本程式上傳的物件只寫入一次、不會被覆寫，所以這樣做沒有問題。若在同一個 key 下替換了物件，請執行 `pnpm r2-download --refresh`。資料夾無法寫入時，本機伺服器記錄一次原因，並照有快取之前的方式轉址到 bucket。

快取物件與 bucket 物件適用同一條規則：請求必須指名一篇引用該 key 的筆記。快取是受信任的本機狀態，不會再與 bucket 核對：放進 `.cache/r2-assets` 的檔案（例如不顧 `.gitignore` 強制加入、隨複製的儲存庫而來的檔案）會被當成該物件提供，所以把複製來的儲存庫的 `.cache/` 當作它的程式碼看待。快取只以物件 key 為索引，因此假設一個 checkout 只對應一個 bucket。在應用程式的 R2 管理介面刪除或移動物件，或用 MCP `delete_asset` 刪除物件時，也會一併移除它的快取副本。

`MYGITNOTES_R2_REMOTE_URL` 是部署網址；若貼上的是連接器網址（`…/mcp/<token>`），會去掉 `/mcp/<token>` 這一段，token 仍然只從 `MYGITNOTES_R2_REMOTE_TOKEN` 讀取。部署回傳的下載網址只有在 `https`（或指向本機的 `http`）時才會讀取，且不跟隨轉址。

### 連同圖片下載筆記

- **網頁。** 引用了 `r2:` 物件的筆記，匯出選單會多出**連同圖片下載 (.zip)**。壓縮檔內有筆記與物件，筆記裡的引用改指向同一層的 `assets/<object-key>`。抓不到的物件保留原本的 `r2:` 引用，並列在 `missing-assets.txt`。壓縮檔在瀏覽器中產生，上限 512 MiB；在 hosted 部署上，瀏覽器直接向 bucket 讀取物件，因此上述 bucket CORS 規則必須允許來自 `APP_URL` 的 GET。
- **MCP。** `download_assets` 帶筆記的 `path`。經 hosted `/mcp` 呼叫時，每個被筆記引用的物件回傳一個 5 分鐘有效的網址，每次最多 50 個，唯讀授權也能使用。經本機 stdio 伺服器呼叫時，物件存進上述快取，每個物件最多 64 MiB（更大的列在 `missing`；`pnpm r2-download` 不限大小），並回傳每個檔案的路徑。
