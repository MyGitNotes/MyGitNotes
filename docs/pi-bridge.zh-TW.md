# 讓 Agent 面板使用你自己電腦上的 Pi

[English](pi-bridge.md) · [繁體中文](pi-bridge.zh-TW.md)

這份指南寫給想在雲端或自架的 MyGitNotes 上使用 Agent 面板，並讓自己電腦上的 [Pi][pi] 來回答的人。
你只要執行一行指令，複製一組配對碼，貼進 MyGitNotes 就好，不必 clone 這個儲存庫。

## 這是什麼

Pi 是 Agent 面板背後的程式碼 agent。
雲端的 MyGitNotes 頁面無法替你執行 Pi，所以由一個叫 Pi bridge 的小程式在你的電腦上執行 Pi，並讓你的頁面和它連線。
你的模型登入與供應商金鑰都留在你的電腦上，頁面只會拿到每次對話專用、很快就會過期的 token。

Bridge 是 npm 套件 `mygitnotes-pi-bridge`。
配對碼是一串文字，裡面寫著你的 bridge 在哪裡，以及雙方共用的 secret。

## 需要準備什麼

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
| `-- <參數>` | `--` 後面的參數原封不動交給 Pi，例如 `-- --thinking high`。 |

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

## 安全性

- **Secret 只留在你的電腦與部署上。**
  頁面看不到它，只會拿到會過期、而且只屬於一個 session 的 token（呼叫 bridge 的 token 一分鐘過期，對話的 token 十分鐘過期）。
  配對碼裡含有 secret，所以要像密碼一樣保管。
  一旦外流，就用 `--rotate-secret` 重新產生，並貼上新的配對碼。
- **只有列出的頁面與人能進來。**
  Bridge 只接受你用 `--origin` 指定的頁面 origin，部署也只會對你列出的登入帳號顯示 Agent。
- **Shell 輸入是關閉的。**
  對話框裡以 `!command` 開頭的 shell 指令會被拒絕。
- **Agent 本身仍然是 Pi。**
  Pi 以你的身分在你的電腦上執行，它自己的工具可以讀檔案、執行指令。
  它的工作資料夾是空的，筆記工具只會在你的瀏覽器裡產生工作變更，由你審查後才提交。
  任何拿到 secret 又連得到 bridge 的人，都能和這個 Pi 對話，所以請保管好配對碼。
  想拿掉 Pi 內建的檔案與指令工具、只留下筆記工具，啟動 bridge 時加上 `-- --no-builtin-tools`。

## 疑難排解

| 你看到的情況 | 處理方式 |
| --- | --- |
| `Pi was not found` | 用 `npm install -g @earendil-works/pi-coding-agent` 安裝 Pi，再重新啟動 bridge。 |
| Agent 要求選擇模型 | 在終端機執行一次 `pi` 並登入，或加入供應商金鑰。 |
| `--tunnel needs cloudflared` | 安裝 [cloudflared][cloudflared]，或改用 `--public-url`。 |
| `Port 8787 is already in use` | 用 `--port` 指定別的 port。 |
| 看不到面板 | 你的登入帳號要列在 `MYGITNOTES_EXTERNAL_PI_OWNERS`（自架），或你的 Pro 帳號要有 Agent 權限。 |
| 面板說連不到 bridge | 檢查 bridge 是否還在執行、視窗有沒有關掉、tunnel 是否正常、電腦有沒有睡著。重新啟動之後要貼上新的配對碼。 |
| 面板連上之後立刻中斷 | 頁面的 origin 不被允許，用 `--origin https://你的頁面-origin` 加入。 |
| 配對碼被拒絕 | 請完整重新複製一次。它必須以 `mgnpi1.` 開頭，並指向 `https` 網址。 |
| Agent 原本能用，重新啟動後就不能用了 | Tunnel 的網址或 secret 換了，請貼上最新的配對碼。 |

[pi]: https://github.com/earendil-works/pi
[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
[named-tunnel]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/
