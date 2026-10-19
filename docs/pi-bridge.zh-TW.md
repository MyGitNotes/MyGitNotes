# 讓 Agent 面板使用你自己電腦上的 Pi

[English](pi-bridge.md) · [繁體中文](pi-bridge.zh-TW.md)

這份指南寫給想在雲端或自架的 MyGitNotes 上使用 Agent 面板，並讓自己電腦上的 [Pi][pi] 來回答的人。
你只要執行一行指令，複製一組配對碼，貼進 MyGitNotes 就好，不必 clone 這個儲存庫。

## 這是什麼

Pi 是 Agent 面板背後的程式碼 agent。
雲端的 MyGitNotes 頁面無法替你執行 Pi，所以由一個叫 Pi bridge 的小程式在你的電腦上執行 Pi，並讓你的頁面和它連線。
你的模型登入與供應商金鑰都留在你的電腦上，頁面只會拿到每次對話專用、很快就會過期的 token。
預設情況下，Pi 只能使用 MyGitNotes 的筆記工具，以及你在 Pi 設定好的 MCP 伺服器，不能碰你電腦上的檔案與指令（見[安全性](#安全性)）。

Bridge 是 npm 套件 `mygitnotes-pi-bridge`。
配對碼是一串文字，裡面寫著你的 bridge 在哪裡，以及雙方共用的 secret。

## 需要準備什麼

- **macOS 或 Linux。** 在 Windows 上指令會直接停下並說明；目前還沒有在 Windows 上試過。
- **Node 22 以上。** 用 `node --version` 檢查。
- **登入好模型的 Pi。** 用 `npm install -g @earendil-works/pi-coding-agent` 安裝，執行一次 `pi`，照它的指示登入或加入供應商金鑰。
  Bridge 找不到 Pi 時，會告訴你怎麼安裝。
- **讓頁面能用 HTTPS 連到你的電腦。**
  最簡單的做法是 Cloudflare quick tunnel：安裝 [cloudflared][cloudflared]，再在指令加上 `--tunnel`。
  如果你已經有這台電腦專用的 HTTPS 網址，就用 `--public-url` 指定它。
- **使用 Agent 的權限。**
  在 MyGitNotes Pro 上，你的帳號要有這項權限。
  在自架的部署上，你的登入帳號必須列在 `MYGITNOTES_EXTERNAL_PI_OWNERS`。

## 執行

用 quick tunnel 啟動 bridge：

```sh
npx mygitnotes-pi-bridge --tunnel
```

第一次執行時，它會產生一組夠強的 secret，存在 `~/.config/mygitnotes-pi-bridge/config.json`（只有你自己能讀），在旁邊建立一個給 Pi 用的空工作資料夾，啟動 tunnel，然後印出配對碼：

```text
mgnpi1.eyJ2IjoxLC…
```

使用 Agent 的期間請保持這個視窗開著，要停止時按 `Ctrl+C`。

常用的選項：

| 選項 | 說明 |
| --- | --- |
| `--tunnel` | 啟動 Cloudflare quick tunnel 並使用它的網址，需要 `cloudflared`。 |
| `--public-url <https 網址>` | 使用你自己的 HTTPS 網址，不用 tunnel。 |
| `--origin <頁面 origin>` | 允許使用 bridge 的頁面，例如 `https://notes.example.com`；可重複指定。預設是 `https://app.mygitnotes.com`。 |
| `--port <port>` | 監聽的 port，預設 8787。 |
| `--host <位址>` | 監聽的位址，預設 `127.0.0.1`；只有你自己的 HTTPS 前端跑在另一台機器上時，才需要改成 `0.0.0.0`。 |
| `--model <pattern>` | 指定 Pi 使用的模型。 |
| `--rotate-secret` | 產生新的 secret，舊的配對碼會失效。 |
| `--allow-local-tools` | 讓 Pi 使用它自己的全部工具，包括讀寫你電腦上的檔案、執行指令。使用前請先讀[安全性](#安全性)。 |
| `-- <參數>` | `--` 後面的參數交給 Pi，例如 `-- --thinking high`。Pi 的工具選項（`--tools`、`--no-tools`、`--no-builtin-tools`）會被拒絕，除非你同時加上 `--allow-local-tools`。 |

環境變數 `MYGITNOTES_BRIDGE_SECRET`、`MYGITNOTES_BRIDGE_PUBLIC_URL`、`MYGITNOTES_BRIDGE_ORIGINS`（JSON 陣列）、`MYGITNOTES_BRIDGE_PORT`、`MYGITNOTES_BRIDGE_HOST`、`MYGITNOTES_BRIDGE_CWD` 與 `MYGITNOTES_BRIDGE_PI_ARGS`（JSON 陣列）仍然有效，而且優先於選項。

## 貼上配對碼

**MyGitNotes Pro。**
開啟「設定」，把配對碼貼進要求 Agent 配對碼的欄位。

**自架的部署。**
把配對碼設成部署的環境變數，同時列出可以使用 Agent 的登入帳號，然後重新啟動：

```sh
MYGITNOTES_EXTERNAL_PI_PAIRING=mgnpi1.eyJ2IjoxLC…
MYGITNOTES_EXTERNAL_PI_OWNERS=octocat,id:12345
```

你也可以改設 `MYGITNOTES_EXTERNAL_PI_URL` 與 `MYGITNOTES_EXTERNAL_PI_SECRET` 兩個變數，[部署指南](deploy.zh-TW.md#選用透過自己的-pi-bridge-使用-agent-面板)有說明。
同時設定配對碼與這兩個變數中的任何一個，會直接報錯。
自架的頁面還要讓 bridge 允許：啟動時加上 `--origin https://你的部署網址`，也就是大家開啟頁面時用的網址的 origin。

## Quick tunnel 的網址會變

Cloudflare quick tunnel 每次啟動 bridge 都會換新網址。
所以重新啟動之後，要再執行一次指令，並把新的配對碼再貼一次。
想要網址永遠不變，請用[具名的 Cloudflare tunnel][named-tunnel] 或你自己的 HTTPS 網址，並用 `--public-url` 指定。
這樣配對碼在重新啟動後也不會變，因為 secret 存在設定檔裡。

## 讓它持續執行

Bridge 在執行、你的電腦也醒著而且連著網路時，Agent 才能運作。
如果不想一直開著視窗，可以交給會自動重啟的工具執行，例如 `launchd`、`systemd` 或 `pm2`。
這種做法要搭配固定網址，不要用 quick tunnel。

指令啟動時會印出配對碼，所以會保存輸出的工具，會把配對碼（也就是裡面的 secret）寫進紀錄檔。
請讓這些紀錄檔只有你自己能讀；一旦紀錄檔被分享出去，就用 `--rotate-secret` 換一組。

## 安全性

- **Secret 只留在你的電腦與部署上。**
  頁面看不到它，只會拿到會過期、而且只屬於一個 session 的 token（呼叫 bridge 的 token 一分鐘過期，對話的 token 十分鐘過期）。
  自架的部署把 secret 放在部署的環境變數裡。
  使用 MyGitNotes Pro 時，secret 也會加密後存在 Pro 的伺服器上，由它簽發那些 token。
  配對碼裡含有 secret，所以要像密碼一樣保管，而且任何會保存指令輸出的工具，紀錄檔裡都會有它。
  一旦外流，就用 `--rotate-secret` 重新產生，並貼上新的配對碼。
- **只有列出的頁面與人能進來。**
  Bridge 只接受你用 `--origin` 指定的頁面 origin，部署也只會對你列出的登入帳號顯示 Agent。
- **Shell 輸入是關閉的。**
  對話框裡以 `!command` 開頭的 shell 指令會被拒絕。
- **預設 Pi 只有筆記工具與 MCP。**
  Bridge 啟動 Pi 時，只開放 MyGitNotes 的五個筆記工具，以及你在 Pi 設定的 MCP 伺服器的工具（Pi 的 `mcp` 工具與 `mcp__<伺服器>__<工具>`）。
  Pi 的檔案與指令工具（`read`、`write`、`edit`、`bash` 等）是關的，其他擴充套件的工具也不會提供。
  筆記工具只會在你的瀏覽器裡產生工作變更，由你審查後才提交。
  Pi 的工作資料夾是空的。
  這個選擇由 bridge 固定：它排在你交給 Pi 的所有參數之後，所以 `-- --tools …` 會被拒絕。
  **你自己設定的 MCP 伺服器，Agent 也連得到。**
  你在 Pi 設定的任何 MCP 伺服器（`pi mcp list` 看得到）都能被 Agent 使用，權限與伺服器本身相同；能讀你的檔案、或能以你的身分呼叫某項服務的伺服器，對 Agent 也一樣。
  不想讓 Agent 用的伺服器，請先從 Pi 移除，或在沒有設定它的帳號下啟動 bridge。
- **`--allow-local-tools` 等於把你的電腦交給 Pi。**
  它會恢復 Pi 的全部工具，bridge 啟動時會印出警告。
  這時 Pi 以你的身分執行，可以讀檔案、寫檔案、執行指令。
  有三種來源可以左右它：筆記裡寫著要 Agent 照做的文字（別人給你的筆記、或請它讀的網頁）、任何拿到 secret 又連得到 bridge 的人，以及在自架的部署上，每一個列在 `MYGITNOTES_EXTERNAL_PI_OWNERS` 的登入帳號，因為他們用的是同一個 Pi。
  只在你願意承擔這些風險的電腦與帳號下使用，並保管好配對碼。

## 疑難排解

| 你看到的情況 | 處理方式 |
| --- | --- |
| `Pi was not found` | 用 `npm install -g @earendil-works/pi-coding-agent` 安裝 Pi，再重新啟動 bridge。 |
| Agent 要求選擇模型 | 在終端機執行一次 `pi` 並登入，或加入供應商金鑰。 |
| `--tunnel needs cloudflared` | 安裝 [cloudflared][cloudflared]，或改用 `--public-url`。 |
| `Port 8787 is already in use` | 用 `--port` 指定別的 port。 |
| 看不到面板 | 你的登入帳號要列在 `MYGITNOTES_EXTERNAL_PI_OWNERS`（自架），或你的 Pro 帳號要有 Agent 權限。 |
| 面板說連不到 bridge | 檢查 bridge 是否還在執行、視窗有沒有關掉、tunnel 是否正常、電腦有沒有睡著。重新啟動之後要貼上新的配對碼。 |
| 面板連不上，但 bridge 在執行、網址也正確 | 頁面的 origin 不被允許，bridge 在連線一開始就拒絕了（403）。用 `--origin https://你的頁面-origin` 加入。 |
| `supports only macOS and Linux` | Bridge 目前還不能在 Windows 上執行，請改用 macOS 或 Linux。 |
| Pi 的工具選項被拒絕 | Bridge 固定了 Pi 的工具。只有在你接受它會開放的範圍時，才加上 `--allow-local-tools`（見[安全性](#安全性)）。 |
| 配對碼被拒絕 | 請完整重新複製一次。它必須以 `mgnpi1.` 開頭，並指向 `https` 網址。 |
| Agent 原本能用，重新啟動後就不能用了 | Tunnel 的網址或 secret 換了，請貼上最新的配對碼。 |

[pi]: https://github.com/earendil-works/pi
[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
[named-tunnel]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/
