'use strict';

const assert = require('node:assert');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('local.desktop-mcp');
  assert.ok(extension, 'extension not found');
  await extension.activate();

  const tools = vscode.lm.tools.filter((t) => t.name.startsWith('desktopMcp_'));
  assert.deepStrictEqual(
    tools.map((t) => t.name).sort(),
    ['desktopMcp_captureScreenshot', 'desktopMcp_getScreenSize']
  );

  const sizeTool = tools.find((t) => t.name === 'desktopMcp_getScreenSize');
  const sizeResult = await vscode.lm.invokeTool(sizeTool.name, {
    input: {},
    toolInvocationToken: undefined
  });
  const sizeText = sizeResult.content.find((p) => p instanceof vscode.LanguageModelTextPart);
  const size = JSON.parse(sizeText.value);
  assert.ok(size.virtualScreen.width > 0 && size.virtualScreen.height > 0, 'bad screen size');

  const shotTool = tools.find((t) => t.name === 'desktopMcp_captureScreenshot');
  const shotResult = await vscode.lm.invokeTool(shotTool.name, {
    input: { region: { x: 0, y: 0, width: 240, height: 160 }, format: 'jpeg', quality: 60 },
    toolInvocationToken: undefined
  });
  const image = shotResult.content.find((p) => p instanceof vscode.LanguageModelDataPart);
  assert.ok(image, 'no image part returned');
  assert.strictEqual(image.mimeType, 'image/jpeg');
  assert.ok(image.data.byteLength > 500, 'image too small');

  console.log(
    `VSCODE E2E OK screen=${size.virtualScreen.width}x${size.virtualScreen.height} image=${image.data.byteLength}B`
  );
}

module.exports = { run };
