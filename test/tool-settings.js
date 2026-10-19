'use strict';

// Verifies per-tool enable/disable for both the MCP server and the VS Code tools.
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { startHttpServer } = require('../src/http-server');

class Disposable {
  constructor(fn) {
    this.dispose = fn || (() => {});
  }
}

const settings = {
  'desktopMcp.tools.getScreenSize': true,
  'desktopMcp.tools.captureScreenshot': true,
  'desktopMcp.httpServer': false,
  'desktopMcp.httpPort': 7841,
  'desktopMcp.registerMcpServer': false
};

const vscodeStub = {
  EventEmitter: class {
    constructor() {
      this.event = () => new Disposable();
    }
    fire() {}
  },
  Disposable,
  Uri: { file: (p) => ({ fsPath: p }) },
  LanguageModelTextPart: class {
    constructor(value) {
      this.value = value;
    }
  },
  LanguageModelDataPart: { image: (data, mime) => ({ kind: 'image', data, mime }) },
  LanguageModelToolResult: class {
    constructor(parts) {
      this.parts = parts;
    }
  },
  McpStdioServerDefinition: class {},
  ConfigurationTarget: { Global: 1 },
  window: {
    setStatusBarMessage: () => new Disposable(),
    showInputBox: async () => undefined,
    showQuickPick: async () => undefined,
    showInformationMessage: () => undefined,
    showWarningMessage: () => undefined,
    showErrorMessage: () => undefined
  },
  commands: { registerCommand: () => new Disposable(), executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => (key in settings ? settings[key] : fallback),
      update: async () => {}
    }),
    onDidChangeConfiguration: () => new Disposable()
  },
  lm: {
    registerTool: (name, tool) => {
      (globalThis.__tools ||= {})[name] = tool;
      return new Disposable();
    },
    registerMcpServerDefinitionProvider: () => new Disposable()
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(__dirname, '..', 'extension.js'));

async function stdioClient(env) {
  const client = new Client({ name: 'tool-filter', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, '..', 'bin', 'desktop-mcp.js')],
      env: { ...process.env, ...env }
    })
  );
  return client;
}

(async () => {
  // --- MCP over stdio: disabled tool is hidden and refuses calls ---
  let client = await stdioClient({ DESKTOP_MCP_DISABLED_TOOLS: 'get_screen_size' });
  let tools = (await client.listTools()).tools.map((t) => t.name);
  assert.deepStrictEqual(tools, ['capture_screenshot']);

  const refused = await client.callTool({ name: 'get_screen_size', arguments: {} });
  assert.strictEqual(refused.isError, true);
  assert.match(refused.content[0].text, /disabled by the user/);
  await client.close();

  // --- MCP over stdio: both enabled ---
  client = await stdioClient({ DESKTOP_MCP_DISABLED_TOOLS: '' });
  tools = (await client.listTools()).tools.map((t) => t.name);
  assert.deepStrictEqual(tools, ['get_screen_size', 'capture_screenshot']);
  await client.close();

  // --- MCP over HTTP with a filter ---
  const httpServer = await startHttpServer({
    port: 0,
    isToolEnabled: (name) => name !== 'capture_screenshot'
  });
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const httpClient = new Client({ name: 'http-filter', version: '1.0.0' });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(httpServer.url)));
  const httpTools = (await httpClient.listTools()).tools.map((t) => t.name);
  assert.deepStrictEqual(httpTools, ['get_screen_size']);
  const httpRefused = await httpClient.callTool({ name: 'capture_screenshot', arguments: {} });
  assert.strictEqual(httpRefused.isError, true);
  assert.match(httpRefused.content[0].text, /disabled by the user/);
  await httpClient.close();
  await httpServer.close();

  // --- VS Code tools: disabled tool returns the message instead of data ---
  extension.activate({ subscriptions: [], extensionPath: path.join(__dirname, '..'), asAbsolutePath: (p) => p });
  const sizeTool = globalThis.__tools['desktopMcp_getScreenSize'];
  const shotTool = globalThis.__tools['desktopMcp_captureScreenshot'];

  settings['desktopMcp.tools.getScreenSize'] = false;
  const disabled = await sizeTool.invoke({ input: {} });
  assert.match(disabled.parts[0].value, /disabled by the user/);
  assert.match(disabled.parts[0].value, /desktopMcp\.tools\.getScreenSize/);

  settings['desktopMcp.tools.getScreenSize'] = true;
  const enabled = await sizeTool.invoke({ input: {} });
  assert.ok(JSON.parse(enabled.parts[0].value).virtualScreen.width > 0);

  settings['desktopMcp.tools.captureScreenshot'] = false;
  const prepared = await shotTool.prepareInvocation({ input: {} });
  assert.match(prepared.invocationMessage, /disabled/);
  const shotDisabled = await shotTool.invoke({ input: { region: { x: 0, y: 0, width: 10, height: 10 } } });
  assert.match(shotDisabled.parts[0].value, /disabled by the user/);

  settings['desktopMcp.tools.captureScreenshot'] = true;
  const shot = await shotTool.invoke({ input: { region: { x: 0, y: 0, width: 120, height: 80 } } });
  assert.strictEqual(shot.parts[0].kind, 'image');

  await extension.deactivate();
  console.log('tool settings OK: hidden from list, disabled message on call (stdio + http + vscode)');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
