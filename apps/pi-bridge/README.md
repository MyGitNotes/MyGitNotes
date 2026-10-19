# mygitnotes-pi-bridge

Run [Pi][pi] on your own computer for the MyGitNotes agent panel, and connect them with one pairing code.

```sh
npx mygitnotes-pi-bridge --tunnel
```

The command makes a secret on the first run, starts a Cloudflare quick tunnel and prints a pairing code.
Paste the code into MyGitNotes Pro (Settings), or set it as `MYGITNOTES_EXTERNAL_PI_PAIRING` on a self-hosted deployment.

You need Node 22 or newer, Pi signed in to a model (`npm install -g @earendil-works/pi-coding-agent`), and [cloudflared][cloudflared] for `--tunnel`.
Without a tunnel, give your own HTTPS address with `--public-url`.
A quick tunnel address changes on every restart, so use a named Cloudflare tunnel or your own HTTPS for a stable one.

Run `npx mygitnotes-pi-bridge --help` for every option.
The full guide, with security notes and troubleshooting, is in [English][guide] and [繁體中文][guide-zh].

[pi]: https://github.com/earendil-works/pi
[cloudflared]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
[guide]: https://github.com/wayne930242/MyGitNotes/blob/core/docs/pi-bridge.md
[guide-zh]: https://github.com/wayne930242/MyGitNotes/blob/core/docs/pi-bridge.zh-TW.md
