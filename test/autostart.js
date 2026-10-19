'use strict';

// Verifies that activating the extension with desktopMcp.httpServer=true starts the HTTP server.
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert');
const net = require('node:net');

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

class Disposable {
  constructor(fn) {
    this.dispose = fn || (() => {});
  }
}

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
    showInputBox: async () => undefined,
    showInformationMessage: (msg) => console.log('INFO', msg),
    showErrorMessage: (msg) => console.log('ERROR', msg),
    showWarningMessage: (msg) => console.log('WARN', msg)
  },
  workspace: {
    getConfiguration: () => ({
      get: (key) => (key === 'httpServer' ? true : key === 'httpPort' ? globalThis.__port : undefined)
    }),
    onDidChangeConfiguration: () => new Disposable()
  },
  ConfigurationTarget: { Global: 1 },
  commands: {
    registerCommand: (id, fn) => {
      (globalThis.__commands ||= {})[id] = fn;
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
  globalThis.__port = await freePort();
  extension.activate({ subscriptions: [], extensionPath: path.join(__dirname, '..'), asAbsolutePath: (p) => p });
  await new Promise((r) => setTimeout(r, 500));

  const response = await fetch(`http://127.0.0.1:${globalThis.__port}/health`);
  assert.strictEqual(response.status, 200);
  const body = await response.json();
  assert.strictEqual(body.name, 'desktop-mcp');

  await extension.deactivate();
  await new Promise((r) => setTimeout(r, 200));
  await assert.rejects(fetch(`http://127.0.0.1:${globalThis.__port}/health`), 'server should be closed after deactivate');

  console.log('autostart OK: server started on activation and stopped on deactivate');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
