# Desktop MCP

Screen size and screenshots for AI agents. Works two ways:

- **VS Code extension** — registers two Language Model Tools, so GitHub Copilot Chat (agent mode) can call them directly.
- **MCP server** — the same two tools over stdio, so Claude Code, Grok, Cursor, Windsurf, Cline or any other MCP client can use them.

No PowerShell, no external binaries: capture is done by the native [`node-screenshots`](https://www.npmjs.com/package/node-screenshots) addon, encoding by [`sharp`](https://www.npmjs.com/package/sharp).

## Tools

### `get_screen_size`
Returns the screen geometry in pixels:

```json
{
  "platform": "win32",
  "virtualScreen": { "x": 0, "y": 0, "width": 3200, "height": 2000 },
  "displays": [
    {
      "index": 0,
      "id": 65537,
      "name": "Unknown Monitor 65537",
      "primary": true,
      "scaleFactor": 2,
      "rotation": 0,
      "bounds": { "x": 0, "y": 0, "width": 3200, "height": 2000 }
    }
  ]
}
```

`virtualScreen` is the bounding box of all displays; its origin can be negative on multi-monitor setups.

### `capture_screenshot`

| Argument | Type | Description |
|---|---|---|
| `region` | `{ x, y, width, height }` | Rectangle in pixels, relative to the virtual screen origin. Omit for the whole screen. |
| `display` | `number` | Display index from `get_screen_size`. Ignored when `region` is set. |
| `format` | `"png" \| "jpeg"` | Default `png`. |
| `quality` | `number` | JPEG quality 1–100, default 90. |
| `savePath` | `string` | Absolute path to also save the image to. |

Returns the image plus a JSON metadata block (actual region, size, byte count, saved path). Regions that span several monitors are stitched together; regions are clipped to the screen.

### Enabling and disabling tools

Each tool can be turned off in **Settings → Desktop MCP → Tools**:

| Setting | Default | Effect when `false` |
|---|---|---|
| `desktopMcp.tools.getScreenSize` | `true` | `getScreenSize` / `get_screen_size` is hidden from agents |
| `desktopMcp.tools.captureScreenshot` | `true` | `captureScreenshot` / `capture_screenshot` is hidden from agents |

A disabled tool is removed from the tool list (`tools/list` for MCP, the Copilot tool picker for VS Code). If an agent calls it anyway, it gets a normal result explaining that the user disabled it, e.g.:

> Tool "get_screen_size" is disabled by the user in the Desktop MCP settings. Do not retry it; ask the user to enable it in Settings → Desktop MCP → Tools if it is needed.

For the standalone server the same filter is available through the `DESKTOP_MCP_DISABLED_TOOLS` environment variable (comma-separated tool names).

## Use with GitHub Copilot in VS Code

1. Install the extension (see below).
2. Open Copilot Chat in **Agent** mode and ask, e.g. *"take a screenshot of the top-left 800x600 of my screen"*.
3. The tools appear as `getScreenSize` / `captureScreenshot` and can also be referenced with `#getScreenSize` / `#captureScreenshot`.

## Use with Claude Code, Grok, Cursor, Cline, ...

There are two transports. **stdio is the default and needs no port** — the client starts the process itself. HTTP mode is there if you prefer a long-running local server on a port (like other desktop MCP bridges).

### Option A — stdio (recommended)

```json
{
  "mcpServers": {
    "desktop": {
      "command": "node",
      "args": ["C:/shared-data/reps/mcp-screenshot/bin/desktop-mcp.js"]
    }
  }
}
```

- **Claude Code**: `claude mcp add desktop -- node C:/shared-data/reps/mcp-screenshot/bin/desktop-mcp.js`
- **Grok / Cursor / Windsurf / Cline**: add the same `mcpServers` entry to the client's MCP config file.
- **VS Code itself**: set `desktopMcp.registerMcpServer` to `true` to expose the server through the extension, or add the JSON above to `.vscode/mcp.json`.

### Option B — HTTP on a local port

The extension starts the HTTP server **automatically** when VS Code activates it (`desktopMcp.httpServer`, default `true`), so after installing the extension you only need to point the client at the URL:

```json
{
  "mcpServers": {
    "desktop": {
      "type": "http",
      "url": "http://127.0.0.1:7841/mcp"
    }
  }
}
```

- **Claude Code**: `claude mcp add --transport http desktop http://127.0.0.1:7841/mcp`
- Health check: `curl http://127.0.0.1:7841/health` → `{"ok":true,"name":"desktop-mcp"}`
- Change the port with `desktopMcp.httpPort`, or turn autostart off with `desktopMcp.httpServer: false`.

### Commands (Ctrl+Shift+P)

| Command | What it does |
|---|---|
| `Desktop MCP: Install MCP` | Pick MCP clients (Claude Code, Codex, Grok, Copilot, Cursor, Cline, Roo, Windsurf, Antigravity) and write/refresh the `desktop-mcp` entry in each config |
| `Desktop MCP: Server: Start` | Starts the HTTP server on the configured port |
| `Desktop MCP: Server: Stop` | Stops it |
| `Desktop MCP: Server: Status` | Shows the URL and health check result |
| `Desktop MCP: Server: Set Port` | Asks for a port (1–65535), saves it to settings and restarts the server |

Changing `desktopMcp.httpPort` in Settings also restarts the server automatically.

### Install MCP

`Desktop MCP: Install MCP` shows a multi-select list of clients. Already-configured clients are pre-selected and marked `already configured — will be updated`, so running it again after a port change rewrites the URL everywhere.

| Client | Config file | Entry |
|---|---|---|
| Claude Code | `~/.claude.json` | `mcpServers.desktop-mcp` → `{ type: "http", url }` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.desktop-mcp]` → `url`, `enabled` |
| Grok | `~/.grok/config.toml` | `[mcp_servers.desktop-mcp]` → `url`, `enabled` |
| GitHub Copilot (VS Code) | `<User>/mcp.json` | `servers.desktop-mcp` → `{ type: "http", url }` |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json` | `mcpServers.desktop-mcp` → `{ type: "http", url, tools: ["*"] }` |
| Cursor | `Cursor/User/globalStorage/cursor.mcp/settings/mcp_settings.json` (fallback `~/.cursor/mcp.json`) | `mcpServers.desktop-mcp` → `streamableHttp` |
| Cline | `Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | `mcpServers.desktop-mcp` → `streamableHttp` |
| Roo Code | `Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json` | `mcpServers.desktop-mcp` → `streamableHttp` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers.desktop-mcp` → `streamableHttp` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `mcpServers.desktop-mcp` → `streamableHttp` |

Existing keys in those files are preserved; only the `desktop-mcp` entry is added or overwritten.

If you don't want to keep VS Code open, run the server standalone instead:

```bash
node bin/desktop-mcp.js --http                 # http://127.0.0.1:7841/mcp
node bin/desktop-mcp.js --http --port 7841     # explicit port
node bin/desktop-mcp.js --http --host 0.0.0.0  # expose on the network (not recommended)
```

The HTTP transport is stateless: every request gets its own server instance, so several agents can connect at once. It binds to `127.0.0.1` by default — anyone who can reach the port can take screenshots of your desktop, so do not expose it publicly.

### Run by hand

```bash
node bin/desktop-mcp.js          # MCP over stdio
node bin/desktop-mcp.js --help   # usage
```

## Install the extension

```bash
npm install
npx @vscode/vsce package
code --install-extension desktop-mcp-0.1.0.vsix
```

Or press `F5` in VS Code with this folder open to run it from source.

## Platform notes

- **Windows / macOS / Linux (X11)** — supported by `node-screenshots`.
- **Wayland** — screen capture may be restricted by the compositor; X11 sessions work.
- Coordinates are physical pixels. On high-DPI displays `scaleFactor` is reported so you can convert from logical coordinates.

## Tests

```bash
npm test          # stdio + HTTP MCP servers, extension wiring against a stubbed vscode API
npm run test:e2e  # real VS Code instance: registers tools, captures a screenshot
```
