# Use the agent panel with Pi on your own computer

[English](pi-bridge.md) · [繁體中文](pi-bridge.zh-TW.md)

This guide is for a person who wants the MyGitNotes agent panel on a hosted or self-hosted deployment, answered by [Pi][pi] running on their own computer.
You run one command, copy one pairing code and paste it into MyGitNotes.
You do not need to clone this repository.

## What it is

Pi is the coding agent behind the agent panel.
A hosted MyGitNotes page cannot run Pi for you, so a small program called the Pi bridge runs Pi on your computer and lets your page talk to it.
Your model login and provider keys stay on your computer; the page only receives a short-lived token for each conversation.
By default Pi can use only the MyGitNotes note tools and the MCP servers you set up in Pi, not the files and commands of your computer (see [Security](#security)).

The bridge is the npm package `mygitnotes-pi-bridge`.
The pairing code is the one string that tells MyGitNotes where your bridge is and holds the secret they share.

## What you need

- **macOS or Linux.** The command stops with a message on Windows; it has not been tried there yet.
- **Node 22 or newer.** Check with `node --version`.
- **Pi, signed in to a model.** Install it with `npm install -g @earendil-works/pi-coding-agent`, run `pi` once, and sign in or add a provider key as it asks.
  The bridge tells you how to install Pi when it cannot find it.
- **A way for the page to reach your computer over HTTPS.**
  The easiest is a Cloudflare quick tunnel: install [cloudflared][cloudflared] and add `--tunnel` to the command.
  If you already have your own HTTPS address for this computer, give it with `--public-url`.
- **Permission to use the agent.**
  On MyGitNotes Pro your account needs it.
  On a self-hosted deployment, your sign-in login must be in `MYGITNOTES_EXTERNAL_PI_OWNERS`.

## Run it

Start the bridge with a quick tunnel:

```sh
npx mygitnotes-pi-bridge --tunnel
```

The first time, it makes a strong secret, keeps it in `~/.config/mygitnotes-pi-bridge/config.json` (readable only by you), creates an empty working folder for Pi beside it, starts the tunnel and prints a pairing code:

```text
mgnpi1.eyJ2IjoxLC…
```

Leave the window open while you use the agent.
Press `Ctrl+C` to stop it.

Useful options:

| Option | Meaning |
| --- | --- |
| `--tunnel` | Start a Cloudflare quick tunnel and use its address. Needs `cloudflared`. |
| `--public-url <https address>` | Use your own HTTPS address instead of a tunnel. |
| `--origin <page origin>` | A page allowed to use the bridge, such as `https://notes.example.com`. Repeat it for several. Default: `https://app.mygitnotes.com`. |
| `--port <port>` | The port to listen on. Default: 8787. |
| `--host <address>` | The address to listen on. Default: `127.0.0.1`; use `0.0.0.0` only when your own HTTPS front end runs on another machine. |
| `--model <pattern>` | The Pi model to use. |
| `--rotate-secret` | Make a new secret. The old pairing code stops working. |
| `--allow-local-tools` | Let Pi use all of its own tools, including reading and writing files and running commands on your computer. Read [Security](#security) before you use it. |
| `-- <arguments>` | Everything after `--` goes to Pi, for example `-- --thinking high`. Pi's tool options (`--tools`, `--no-tools`, `--no-builtin-tools`) are refused unless you also pass `--allow-local-tools`. |

The environment variables `MYGITNOTES_BRIDGE_SECRET`, `MYGITNOTES_BRIDGE_PUBLIC_URL`, `MYGITNOTES_BRIDGE_ORIGINS` (a JSON array), `MYGITNOTES_BRIDGE_PORT`, `MYGITNOTES_BRIDGE_HOST`, `MYGITNOTES_BRIDGE_CWD` and `MYGITNOTES_BRIDGE_PI_ARGS` (a JSON array) still work and win over the options.

## Paste the pairing code

**MyGitNotes Pro.**
Open Settings and paste the code where it asks for the agent's pairing code.

**A self-hosted deployment.**
Set the code as an environment variable on the deployment, with the logins that may use the agent, and restart it:

```sh
MYGITNOTES_EXTERNAL_PI_PAIRING=mgnpi1.eyJ2IjoxLC…
MYGITNOTES_EXTERNAL_PI_OWNERS=octocat,id:12345
```

You can instead set `MYGITNOTES_EXTERNAL_PI_URL` and `MYGITNOTES_EXTERNAL_PI_SECRET` separately; the [deployment guide](deploy.md#optional-an-agent-panel-through-your-own-pi-bridge) lists them.
Giving the pairing code and either of those two together is an error.
A self-hosted page must also be allowed by the bridge: start it with `--origin https://your-deployment.example.com`, with the origin of the address people open the page at.

## A quick tunnel address changes

A Cloudflare quick tunnel gets a new address every time the bridge starts.
After a restart, run the command again and paste the new pairing code again.
For an address that never changes, use a [named Cloudflare tunnel][named-tunnel] or your own HTTPS address, and pass it with `--public-url`.
Then the code stays the same across restarts, because the secret is kept in the config file.

## Keep it running

The agent works only while the bridge runs and your computer is awake and online.
To keep it going without an open window, run the command under a tool that restarts it, such as `launchd`, `systemd` or `pm2`.
Use a stable address for that, not a quick tunnel.

The command prints the pairing code when it starts, so a tool that keeps its output writes the code, and the secret in it, into a log file.
Keep those log files readable only by you, and run `--rotate-secret` if one is ever shared.

## Security

- **The secret stays on your computer and on the deployment.**
  The page never sees it: it receives tokens that expire (one minute for a call to the bridge, ten minutes for a conversation) and belong to one session.
  On a self-hosted deployment the secret is in the deployment's environment.
  On MyGitNotes Pro it is stored, encrypted, on Pro's server, which uses it to sign those tokens.
  The pairing code contains the secret, so treat it like a password, and expect it in the log of anything that keeps the command's output.
  If it leaks, run with `--rotate-secret` and paste the new code.
- **Only listed pages and people get in.**
  The bridge accepts the page origins you name with `--origin`, and a deployment shows the agent only to the logins you list.
- **The shell box is off.**
  The chat box's `!command` shell lines are refused.
- **By default Pi gets only the note tools and MCP.**
  The bridge starts Pi with the five MyGitNotes note tools and the tools of the MCP servers configured in your Pi (its `mcp` tool and `mcp__<server>__<tool>` tools).
  Pi's file and command tools (`read`, `write`, `edit`, `bash` and the others) are off, and other extensions' tools are not offered.
  The note tools change your notes only as working changes in your browser, which you review and commit.
  Pi's working folder is empty.
  This choice is fixed by the bridge: it comes after anything you pass to Pi, which is why `-- --tools …` is refused.
  **Your own MCP servers are reachable.**
  Whatever MCP servers you set up in Pi (`pi mcp list` shows them) are available to the agent, with the access they have; a server that can read your files or call a service as you does so for the agent too.
  Remove a server you do not want the agent to use, or start the bridge in an account where it is not configured.
- **`--allow-local-tools` gives Pi your computer.**
  It restores all of Pi's tools, and the bridge prints a warning when it starts.
  Pi then runs as you and can read files, write files and run commands.
  Three things can steer it: text in a note that tells the agent what to do (a note you opened from someone else, or a web page it was asked to read), anyone who holds the secret and can reach the bridge, and, on a self-hosted deployment, every login listed in `MYGITNOTES_EXTERNAL_PI_OWNERS`, because they all talk to the same Pi.
  Use it only on a computer and in an account you are willing to expose, and keep the pairing code private.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Pi was not found` | Install Pi with `npm install -g @earendil-works/pi-coding-agent`, then start the bridge again. |
| The agent asks for a model | Run `pi` in a terminal once and sign in, or add a provider key. |
| `--tunnel needs cloudflared` | Install [cloudflared][cloudflared], or use `--public-url`. |
| `Port 8787 is already in use` | Start with another `--port`. |
| The panel is missing | Your login must be in `MYGITNOTES_EXTERNAL_PI_OWNERS` (self-hosted), or your Pro account must have the agent. |
| The panel says the bridge is unreachable | Check the bridge is running and its window is open, the tunnel is up, and your computer is awake. After a restart, paste the new pairing code. |
| The panel cannot connect, with the bridge running and the address right | The page's origin is not allowed, so the bridge refuses the connection at the start (a 403). Add it with `--origin https://your-page-origin`. |
| `supports only macOS and Linux` | The bridge does not run on Windows yet. Use macOS or Linux. |
| Pi's tool options are refused | The bridge fixes Pi's tools. Add `--allow-local-tools` only if you accept what it exposes (see [Security](#security)). |
| The pairing code is refused | Copy it again in full. It must start with `mgnpi1.` and name an `https` address. |
| The agent worked, then stopped working after a restart | The tunnel address or the secret changed. Paste the latest pairing code. |

[pi]: https://github.com/earendil-works/pi
[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
[named-tunnel]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/
