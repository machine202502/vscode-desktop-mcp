'use strict';

// Exercises the Desktop MCP commands: Install MCP / Server Start / Stop / Status / Set Port.
const Module = require('node:module');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert');

class Disposable {
  constructor(fn) {
    this.dispose = fn || (() => {});
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const messages = [];
const commands = {};
const config = { httpServer: false, httpPort: 0 };
const configListeners = [];

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
  window: {
    setStatusBarMessage: () => new Disposable(),
    showInputBox: async () => globalThis.__nextInput,
    showQuickPick: async () => undefined,
    showInformationMessage: (msg) => messages.push(['info', msg]),
    showWarningMessage: (msg) => messages.push(['warn', msg]),
    showErrorMessage: (msg) => messages.push(['error', msg])
  },
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: (id, fn) => {
      commands[id] = fn;
      return new Disposable();
    },
    executeCommand: async () => undefined
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in config ? config[key] : fallback),
      update: async (key, value) => {
        config[key] = value;
        for (const listener of configListeners) {
          listener({ affectsConfiguration: (section) => section === `desktopMcp.${key}` });
        }
      }
    }),
    onDidChangeConfiguration: (listener) => {
      configListeners.push(listener);
      return new Disposable();
    }
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

(async () => {
  config.httpPort = await freePort();
  const port = config.httpPort;
  extension.activate({ subscriptions: [], extensionPath: path.join(__dirname, '..'), asAbsolutePath: (p) => p });

  assert.deepStrictEqual(Object.keys(commands).sort(), [
    'desktopMcp.installMcp',
    'desktopMcp.serverSetPort',
    'desktopMcp.serverStart',
    'desktopMcp.serverStatus',
    'desktopMcp.serverStop'
  ]);

  await commands['desktopMcp.serverStatus']();
  assert.match(messages.at(-1)[1], /not running/);

  await commands['desktopMcp.serverStop']();
  assert.match(messages.at(-1)[1], /not running/);

  await commands['desktopMcp.serverStart']();
  assert.match(messages.at(-1)[1], new RegExp(`server started at http://127\\.0\\.0\\.1:${port}/mcp`));
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);

  await commands['desktopMcp.serverStart']();
  assert.match(messages.at(-1)[1], /already running/);

  await commands['desktopMcp.serverStatus']();
  assert.match(messages.at(-1)[1], /running at .*health: ok/);

  await commands['desktopMcp.serverStop']();
  assert.match(messages.at(-1)[1], /server stopped/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));

  // Set Port: writes the setting and restarts the server on the new port.
  const newPort = await freePort();
  config.httpServer = true;
  globalThis.__nextInput = String(newPort);
  await commands['desktopMcp.serverSetPort']();
  assert.strictEqual(config.httpPort, newPort);
  assert.match(messages.at(-1)[1], new RegExp(`port set to ${newPort}`));
  await new Promise((r) => setTimeout(r, 300));
  assert.match(messages.at(-1)[1], new RegExp(`server restarted at http://127\\.0\\.0\\.1:${newPort}/mcp`));
  assert.strictEqual((await fetch(`http://127.0.0.1:${newPort}/health`)).status, 200);

  // Cancelling the input box leaves the port untouched.
  globalThis.__nextInput = undefined;
  await commands['desktopMcp.serverSetPort']();
  assert.strictEqual(config.httpPort, newPort);

  await extension.deactivate();
  await assert.rejects(fetch(`http://127.0.0.1:${newPort}/health`));
  console.log('commands OK: start / stop / status / set port');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
