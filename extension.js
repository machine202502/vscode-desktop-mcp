'use strict';

const vscode = require('vscode');
const { getScreenSize, captureScreenshot } = require('./src/capture');
const { startHttpServer } = require('./src/http-server');
const agents = require('./src/agents');

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

function textResult(value) {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
  ]);
}

function imageResult(buffer, mimeType, meta) {
  return new vscode.LanguageModelToolResult([
    vscode.LanguageModelDataPart.image(new Uint8Array(buffer), mimeType),
    new vscode.LanguageModelTextPart(JSON.stringify(meta, null, 2))
  ]);
}

const TOOL_SETTINGS = {
  getScreenSize: 'desktopMcp.tools.getScreenSize',
  captureScreenshot: 'desktopMcp.tools.captureScreenshot'
};

function isToolEnabled(key) {
  return vscode.workspace.getConfiguration().get(TOOL_SETTINGS[key], true) !== false;
}

function disabledToolNames() {
  const names = [];
  if (!isToolEnabled('getScreenSize')) names.push('get_screen_size');
  if (!isToolEnabled('captureScreenshot')) names.push('capture_screenshot');
  return names;
}

function disabledToolResult(key) {
  const setting = TOOL_SETTINGS[key];
  return textResult(
    `Tool "${key}" is disabled by the user in the Desktop MCP settings (${setting}). ` +
      'Do not retry it; ask the user to enable it in Settings → Desktop MCP → Tools if it is needed.'
  );
}

class GetScreenSizeTool {
  async invoke() {
    if (!isToolEnabled('getScreenSize')) return disabledToolResult('getScreenSize');
    return textResult(await getScreenSize());
  }
}

class CaptureScreenshotTool {
  async invoke(options) {
    if (!isToolEnabled('captureScreenshot')) return disabledToolResult('captureScreenshot');
    const input = asObject(options && options.input);
    const { buffer, mimeType, meta } = await captureScreenshot(input);
    return imageResult(buffer, mimeType, meta);
  }

  async prepareInvocation(options) {
    if (!isToolEnabled('captureScreenshot')) {
      return { invocationMessage: 'Desktop MCP: captureScreenshot is disabled in settings' };
    }
    const input = asObject(options && options.input);
    const target = input.region
      ? `region ${input.region.width}x${input.region.height} at ${input.region.x},${input.region.y}`
      : input.display !== undefined
        ? `display ${input.display}`
        : 'the whole screen';
    return { invocationMessage: `Capturing a screenshot of ${target}` };
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  context.subscriptions.push(
    vscode.lm.registerTool('desktopMcp_getScreenSize', new GetScreenSizeTool()),
    vscode.lm.registerTool('desktopMcp_captureScreenshot', new CaptureScreenshotTool())
  );

  // Optional: expose the same tools as an MCP server so MCP-only clients can use them.
  if (typeof vscode.lm.registerMcpServerDefinitionProvider === 'function') {
    const didChange = new vscode.EventEmitter();
    context.subscriptions.push(
      didChange,
      vscode.lm.registerMcpServerDefinitionProvider('desktop-mcp', {
        onDidChangeMcpServerDefinitions: didChange.event,
        provideMcpServerDefinitions: () => {
          if (!vscode.workspace.getConfiguration('desktopMcp').get('registerMcpServer')) return [];
          return [
            new vscode.McpStdioServerDefinition(
              'Desktop MCP',
              process.execPath,
              [context.asAbsolutePath('bin/desktop-mcp.js')],
              { DESKTOP_MCP_DISABLED_TOOLS: disabledToolNames().join(',') },
              '0.1.0'
            )
          ];
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('desktopMcp.registerMcpServer')) didChange.fire();
        if (event.affectsConfiguration('desktopMcp.tools')) didChange.fire();
      })
    );
  }

  startHttpServerIfEnabled(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('desktopMcp.serverStart', () => startServerCommand()),
    vscode.commands.registerCommand('desktopMcp.serverStop', () => stopServerCommand()),
    vscode.commands.registerCommand('desktopMcp.serverStatus', () => statusCommand()),
    vscode.commands.registerCommand('desktopMcp.serverSetPort', () => setPortCommand()),
    vscode.commands.registerCommand('desktopMcp.installMcp', () => installMcpCommand()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('desktopMcp.httpPort') || event.affectsConfiguration('desktopMcp.httpServer')) {
        restartForConfigChange();
      }
    })
  );
}

let httpServer = null;

function currentPort() {
  return vscode.workspace.getConfiguration('desktopMcp').get('httpPort') || 7841;
}

async function startServer() {
  if (httpServer) return httpServer;
  httpServer = await startHttpServer({
    port: currentPort(),
    isToolEnabled: (name) =>
      name === 'get_screen_size' ? isToolEnabled('getScreenSize') : isToolEnabled('captureScreenshot')
  });
  return httpServer;
}

async function startHttpServerIfEnabled(context) {
  const config = vscode.workspace.getConfiguration('desktopMcp');
  if (!config.get('httpServer')) return;

  try {
    const server = await startServer();
    vscode.window.setStatusBarMessage(`Desktop MCP: listening on ${server.url}`, 10000);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    vscode.window.showWarningMessage(`Desktop MCP: could not start HTTP server on port ${currentPort()} — ${message}`);
  }
}

async function restartForConfigChange() {
  const enabled = vscode.workspace.getConfiguration('desktopMcp').get('httpServer');
  const wasRunning = Boolean(httpServer);
  await stopHttpServer();

  if (!enabled) {
    if (wasRunning) vscode.window.showInformationMessage('Desktop MCP: server stopped (autostart disabled)');
    return;
  }

  try {
    const server = await startServer();
    vscode.window.showInformationMessage(`Desktop MCP: server restarted at ${server.url}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    vscode.window.showErrorMessage(`Desktop MCP: could not start server on port ${currentPort()} — ${message}`);
  }
}

async function stopHttpServer() {
  if (!httpServer) return false;
  const server = httpServer;
  httpServer = null;
  await server.close();
  return true;
}

async function startServerCommand() {
  if (httpServer) {
    vscode.window.showInformationMessage(`Desktop MCP: server is already running at ${httpServer.url}`);
    return;
  }
  try {
    const server = await startServer();
    vscode.window.showInformationMessage(`Desktop MCP: server started at ${server.url}`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    vscode.window.showErrorMessage(`Desktop MCP: could not start server on port ${currentPort()} — ${message}`);
  }
}

async function stopServerCommand() {
  const stopped = await stopHttpServer();
  if (stopped) vscode.window.showInformationMessage('Desktop MCP: server stopped');
  else vscode.window.showInformationMessage('Desktop MCP: server is not running');
}

async function statusCommand() {
  if (!httpServer) {
    vscode.window.showInformationMessage('Desktop MCP: server is not running');
    return;
  }
  let healthy = false;
  try {
    const response = await fetch(`http://${httpServer.host}:${httpServer.port}/health`);
    healthy = response.ok;
  } catch {
    healthy = false;
  }
  vscode.window.showInformationMessage(
    `Desktop MCP: running at ${httpServer.url} (health: ${healthy ? 'ok' : 'unreachable'})`
  );
}

async function setPortCommand() {
  const input = await vscode.window.showInputBox({
    title: 'Desktop MCP: server port',
    prompt: 'Port for the MCP HTTP server (1-65535)',
    value: String(currentPort()),
    validateInput: (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Enter a port between 1 and 65535';
      return undefined;
    }
  });
  if (input === undefined) return;

  const port = Number(input);
  await vscode.workspace
    .getConfiguration('desktopMcp')
    .update('httpPort', port, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Desktop MCP: port set to ${port}`);
}

function serverUrl() {
  return `http://127.0.0.1:${currentPort()}/mcp`;
}

/**
 * "Install MCP": pick MCP clients and write/refresh the desktop-mcp entry in each.
 * Already-configured clients are re-installed (entry overwritten with the current URL).
 */
async function installMcpCommand() {
  const all = agents.getAgents();
  const items = [];
  for (const agent of all) {
    const installed = await agents.isInstalled(agent);
    const configured = await agents.isConfigured(agent);
    items.push({
      label: agent.displayName,
      description: configured ? '$(check) already configured — will be updated' : installed ? 'detected' : 'not detected',
      detail: agent.configPath,
      picked: configured,
      agent
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Desktop MCP: Install MCP server',
    placeHolder: `Select MCP clients to configure with ${serverUrl()}`,
    canPickMany: true,
    ignoreFocusOut: true
  });
  if (!picked || !picked.length) return;

  const results = [];
  for (const item of picked) {
    try {
      const result = await agents.installForAgent(item.agent, serverUrl());
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({ ok: false, agent: item.agent, error: error && error.message ? error.message : String(error) });
    }
  }

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (failed.length) {
    const detail = failed.map((r) => `${r.agent.displayName}: ${r.error}`).join('\n');
    vscode.window.showErrorMessage(`Desktop MCP: failed for ${failed.length} client(s)\n${detail}`);
  }

  if (ok.length) {
    const names = ok.map((r) => r.agent.displayName).join(', ');
    const openConfig = 'Open Config';
    const choice = await vscode.window.showInformationMessage(
      `Desktop MCP: configured ${names} → ${serverUrl()}`,
      openConfig
    );
    if (choice === openConfig) {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(ok[0].configPath));
    }
  }
}

function deactivate() {
  return stopHttpServer();
}

module.exports = { activate, deactivate };
