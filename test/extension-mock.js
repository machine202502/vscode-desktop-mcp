'use strict';

// Loads extension.js against a minimal vscode API stub to verify registration wiring.
const Module = require('node:module');
const path = require('node:path');
const assert = require('node:assert');

const registered = { tools: [], providers: [] };

class Disposable {
  constructor(fn) {
    this.dispose = fn || (() => {});
  }
}

class EventEmitter {
  constructor() {
    this.event = () => new Disposable();
  }
  fire() {}
}

const vscodeStub = {
  EventEmitter,
  Disposable,
  Uri: { file: (p) => ({ fsPath: p }) },
  LanguageModelTextPart: class {
    constructor(value) {
      this.value = value;
    }
  },
  LanguageModelDataPart: {
    image: (data, mime) => ({ kind: 'image', data, mime })
  },
  LanguageModelToolResult: class {
    constructor(parts) {
      this.parts = parts;
    }
  },
  window: {
    setStatusBarMessage: () => new Disposable(),
    showInputBox: async () => undefined,
    showInformationMessage: (msg) => console.log('INFO', msg),
    showErrorMessage: (msg) => console.log('ERROR', msg),
    showWarningMessage: (msg) => console.log('WARN', msg)
  },
  McpStdioServerDefinition: class {
    constructor(label, command, args, env, version) {
      Object.assign(this, { label, command, args, env, version });
    }
  },
  workspace: {
    getConfiguration: () => ({ get: (key) => (key === 'httpServer' ? false : undefined) }),
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
    registerTool: (name, tool) => {
      registered.tools.push({ name, tool });
      return new Disposable();
    },
    registerMcpServerDefinitionProvider: (id, provider) => {
      registered.providers.push({ id, provider });
      return new Disposable();
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeStub;
  return originalLoad.call(this, request, parent, isMain);
};

const extension = require(path.join(__dirname, '..', 'extension.js'));
const context = {
  subscriptions: [],
  extensionPath: path.join(__dirname, '..'),
  asAbsolutePath: (p) => path.join(__dirname, '..', p)
};

(async () => {
  extension.activate(context);

  assert.deepStrictEqual(
    registered.tools.map((t) => t.name),
    ['desktopMcp_getScreenSize', 'desktopMcp_captureScreenshot']
  );
  assert.strictEqual(registered.providers.length, 1);

  const sizeTool = registered.tools[0].tool;
  const sizeResult = await sizeTool.invoke({ input: {} });
  const size = JSON.parse(sizeResult.parts[0].value);
  assert.ok(size.virtualScreen.width > 0 && size.virtualScreen.height > 0);

  const shotTool = registered.tools[1].tool;
  const prepared = await shotTool.prepareInvocation({ input: { region: { x: 0, y: 0, width: 10, height: 10 } } });
  assert.match(prepared.invocationMessage, /10x10/);

  const shot = await shotTool.invoke({ input: { region: { x: 0, y: 0, width: 200, height: 120 } } });
  assert.strictEqual(shot.parts[0].kind, 'image');
  assert.strictEqual(shot.parts[0].mime, 'image/png');
  assert.ok(shot.parts[0].data.length > 100);
  const meta = JSON.parse(shot.parts[1].value);
  assert.strictEqual(meta.width, 200);
  assert.strictEqual(meta.height, 120);

  console.log('extension mock test OK');
  console.log('screen:', size.virtualScreen.width + 'x' + size.virtualScreen.height);
  console.log('screenshot bytes:', meta.bytes);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
