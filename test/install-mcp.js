'use strict';

// Exercises "Desktop MCP: Install MCP" against a temporary HOME so real agent
// configs are never touched.
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const assert = require('node:assert');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-mcp-agents-'));
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.APPDATA = path.join(sandbox, 'AppData', 'Roaming');
process.env.CODEX_HOME = path.join(sandbox, '.codex');
process.env.COPILOT_HOME = path.join(sandbox, '.copilot');

class Disposable {
  constructor(fn) {
    this.dispose = fn || (() => {});
  }
}

const messages = [];
const commands = {};
const config = { httpServer: false, httpPort: 7841 };
let quickPickResult = [];

const vscodeStub = {
  EventEmitter: class {
    constructor() {
      this.event = () => new Disposable();
    }
    fire() {}
  },
  Disposable,
  Uri: { file: (p) => ({ fsPath: p }) },
  LanguageModelTextPart: class {},
  LanguageModelDataPart: { image: () => ({}) },
  LanguageModelToolResult: class {},
  McpStdioServerDefinition: class {},
  ConfigurationTarget: { Global: 1 },
  window: {
    setStatusBarMessage: () => new Disposable(),
    showInputBox: async () => undefined,
    showQuickPick: async (items) => (typeof quickPickResult === 'function' ? quickPickResult(items) : quickPickResult),
    showInformationMessage: (msg) => {
      messages.push(['info', msg]);
      return undefined;
    },
    showWarningMessage: (msg) => messages.push(['warn', msg]),
    showErrorMessage: (msg) => messages.push(['error', msg])
  },
  commands: {
    registerCommand: (id, fn) => {
      commands[id] = fn;
      return new Disposable();
    },
    executeCommand: async () => undefined
  },
  workspace: {
    getConfiguration: () => ({ get: (key) => config[key], update: async () => {} }),
    onDidChangeConfiguration: () => new Disposable()
  },
  lm: {
    registerTool: () => new Disposable(),
    registerMcpServerDefinitionProvider: () => new Disposable()
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(__dirname, '..', 'extension.js'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

(async () => {
  // Pretend Claude Code, Codex and Grok are installed.
  fs.mkdirSync(path.join(sandbox, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, '.claude.json'), JSON.stringify({ mcpServers: { other: { url: 'x' } } }));
  fs.mkdirSync(path.join(sandbox, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, '.codex', 'config.toml'), '[cli]\ntheme = "dark"\n');
  fs.mkdirSync(path.join(sandbox, '.grok'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, '.grok', 'config.toml'), '[mcp_servers.desktop-mcp]\nurl = "http://old/mcp"\n');

  extension.activate({ subscriptions: [], extensionPath: path.join(__dirname, '..'), asAbsolutePath: (p) => p });
  assert.ok(commands['desktopMcp.installMcp'], 'install command registered');

  // Select Claude Code + Codex + Grok.
  quickPickResult = (items) => items.filter((i) => ['Claude Code', 'Codex', 'Grok'].includes(i.label));
  await commands['desktopMcp.installMcp']();

  const claude = readJson(path.join(sandbox, '.claude.json'));
  assert.deepStrictEqual(claude.mcpServers['desktop-mcp'], { type: 'http', url: 'http://127.0.0.1:7841/mcp' });
  assert.deepStrictEqual(claude.mcpServers.other, { url: 'x' });

  const codex = fs.readFileSync(path.join(sandbox, '.codex', 'config.toml'), 'utf8');
  assert.match(codex, /\[cli\]\ntheme = "dark"/);
  assert.match(codex, /\[mcp_servers\.desktop-mcp\]\nurl = "http:\/\/127\.0\.0\.1:7841\/mcp"\nenabled = true/);

  const grok = fs.readFileSync(path.join(sandbox, '.grok', 'config.toml'), 'utf8');
  assert.match(grok, /url = "http:\/\/127\.0\.0\.1:7841\/mcp"/);
  assert.doesNotMatch(grok, /http:\/\/old\/mcp/);
  assert.strictEqual(grok.match(/\[mcp_servers\.desktop-mcp\]/g).length, 1);

  // Re-install after a port change must update the URL everywhere.
  config.httpPort = 7850;
  await commands['desktopMcp.installMcp']();
  assert.strictEqual(readJson(path.join(sandbox, '.claude.json')).mcpServers['desktop-mcp'].url, 'http://127.0.0.1:7850/mcp');
  assert.match(fs.readFileSync(path.join(sandbox, '.codex', 'config.toml'), 'utf8'), /7850/);
  assert.match(fs.readFileSync(path.join(sandbox, '.grok', 'config.toml'), 'utf8'), /7850/);

  // Cancelling the picker changes nothing.
  quickPickResult = () => undefined;
  await commands['desktopMcp.installMcp']();
  assert.strictEqual(readJson(path.join(sandbox, '.claude.json')).mcpServers['desktop-mcp'].url, 'http://127.0.0.1:7850/mcp');

  await extension.deactivate();
  fs.rmSync(sandbox, { recursive: true, force: true });
  console.log('install MCP OK: claude-code + codex + grok, reinstall updates URL');
})().catch((error) => {
  console.error(error);
  fs.rmSync(sandbox, { recursive: true, force: true });
  process.exit(1);
});
