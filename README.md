# antigravity-auto-retry

Auto-clicks the **Retry** button when Antigravity shows *"high traffic"* or *"agent terminated"* errors.

No network calls. No telemetry. MIT licensed.

---

## Install

### Option A — Ask Antigravity (easiest)

Paste into the chat:

```
Install the Antigravity Auto Retry extension from https://github.com/RoflanTsar/antigravity-auto-retry and apply its workbench patch.

1. Run: curl -fL https://github.com/RoflanTsar/antigravity-auto-retry/raw/main/antigravity-auto-retry.vsix -o /tmp/antigravity-auto-retry.vsix && antigravity --install-extension /tmp/antigravity-auto-retry.vsix
2. Reload this window so the extension activates.
3. Run the "Antigravity Auto Retry: Install" command from the command palette.
4. Reload the window again so the patch takes effect.
```

### Option B — CLI

Requires `antigravity` on PATH (Command Palette → **Shell Command: Install 'antigravity' command in PATH**).

```bash
curl -fL https://github.com/RoflanTsar/antigravity-auto-retry/raw/main/antigravity-auto-retry.vsix -o /tmp/antigravity-auto-retry.vsix && antigravity --install-extension /tmp/antigravity-auto-retry.vsix
```

### Option C — Manual

1. Download [antigravity-auto-retry.vsix](antigravity-auto-retry.vsix).
2. Command Palette → **Extensions: Install from VSIX…** → pick the file.

### Option D — DevTools paste (no install)

No patching. Runs until you reload — paste again next session.

1. Open DevTools (`Cmd+Opt+I` / `Ctrl+Shift+I`) → **Console**.
2. If prompted, type `allow pasting`.
3. Paste the contents of [antigravity-auto-retry.js](extension/antigravity-auto-retry.js) and hit Enter.

### After install (Options A–C)

Reload Antigravity → click **Install Patch** in the notification → **Reload Window**.
Status bar shows **✓ Auto Retry: on**.

> **Permission denied?** Run the `sudo chown` command shown in the modal, then retry.

---

## Update

### Antigravity was updated

Antigravity updates overwrite `workbench.html`, removing the patch. Status bar shows **Auto Retry: reapply**.

→ Click the status bar item or run **Reapply (after update)** → **Reload Window**.

### New extension version

1. Install the new `.vsix`.
2. Reload the window.
3. Run **Refresh Retry Script** → **Back up & Refresh** → **Reload Window**.

---

## Build from source

```bash
git clone https://github.com/RoflanTsar/antigravity-auto-retry.git
cd antigravity-auto-retry/extension && npm install && npm run build && npm run package
# outputs ../antigravity-auto-retry.vsix — requires Node 18+
```

---

## Configuration

### Retry mode

Default: `all` (both error patterns). To only retry high-traffic errors:

```js
localStorage.antigravityAutoRetryMode = 'high-traffic-only'
```

Reload to apply. Remove the key to go back to `all`.

### Circuit breaker

Trips after 10 clicks in 60 seconds.

| Setting | Default | Description |
| --- | --- | --- |
| `antigravityAutoRetry.circuitBreaker.mode` | `cooldown` | `cooldown` pauses and auto-resumes; `stop` requires manual `antigravityAutoRetry.reset()` or reload. |
| `antigravityAutoRetry.circuitBreaker.cooldownSeconds` | `60` | Pause duration for `cooldown` mode. |

Changes re-patch `workbench.html`; reload the window to apply.

---

## Commands

| Command | Description |
| --- | --- |
| Install | First-time setup: backs up `workbench.html`, seeds the script, applies the patch. |
| Reapply (after update) | Re-patches `workbench.html` after an Antigravity update reverted it. |
| Refresh Retry Script | Replaces the script with the bundled version and re-patches. Use after upgrading the extension. |
| Uninstall | Restores `workbench.html` from backup. |
| Show Status | Prints current state and paths. |
| Open Retry Script | Opens `~/.antigravity-auto-retry/antigravity-auto-retry.js` for editing. |

---

## Console API

```js
antigravityAutoRetry.start()
antigravityAutoRetry.stop()
antigravityAutoRetry.status()   // { isRunning, isTripped, panelFound, mode, ... }
antigravityAutoRetry.reset()    // clears the circuit breaker

localStorage.antigravityAutoRetryDebug = '1'  // verbose logging
```

---

## Known tradeoffs

- **"Installation appears corrupt" banner** — Antigravity checksums its bundle. Update the extension and run **Refresh Retry Script** or **Reapply** to refresh the checksum.
- **Antigravity updates revert the patch** — use **Reapply**.
- **Selector drift** — if Antigravity changes button/error markup, edit the script or open an issue.
- **Non-transient errors** — `agent terminated` can fire on auth/quota errors too. Use `high-traffic-only` mode if that's a problem.

---

## License

MIT. Personal productivity tool, not endorsed by Google or Antigravity.
