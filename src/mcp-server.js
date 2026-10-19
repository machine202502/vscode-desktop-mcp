'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} = require('@modelcontextprotocol/sdk/types.js');
const { getScreenSize, captureScreenshot } = require('./capture');

const TOOL_NAMES = { getScreenSize: 'get_screen_size', captureScreenshot: 'capture_screenshot' };

const TOOLS = [
  {
    name: TOOL_NAMES.getScreenSize,
    title: 'Get screen size',
    description:
      'Returns the screen geometry in pixels: the virtual screen bounds (origin may be negative on multi-monitor setups) and the bounds of every display.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: TOOL_NAMES.captureScreenshot,
    title: 'Capture screenshot',
    description:
      'Takes a screenshot of the whole screen or of a rectangular region and returns it as an image. Coordinates are pixels relative to the virtual screen origin (top-left of the leftmost/topmost display).',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'object',
          description: 'Rectangle to capture. Omit to capture the whole virtual screen.',
          properties: {
            x: { type: 'number', description: 'Left edge in pixels.' },
            y: { type: 'number', description: 'Top edge in pixels.' },
            width: { type: 'number', description: 'Width in pixels.' },
            height: { type: 'number', description: 'Height in pixels.' }
          },
          required: ['x', 'y', 'width', 'height'],
          additionalProperties: false
        },
        display: {
          type: 'number',
          description: 'Display index from get_screen_size. Ignored when region is set.'
        },
        format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format. Default png.' },
        quality: { type: 'number', description: 'JPEG quality 1-100. Default 90.' },
        savePath: { type: 'string', description: 'Absolute path to also save the image to.' }
      },
      additionalProperties: false
    }
  }
];

function disabledMessage(name) {
  return (
    `Tool "${name}" is disabled by the user in the Desktop MCP settings. ` +
    'Do not retry it; ask the user to enable it in Settings → Desktop MCP → Tools if it is needed.'
  );
}

/**
 * @param {{isToolEnabled?: (name: string) => boolean}} [options]
 */
function createServer(options = {}) {
  const isToolEnabled = options.isToolEnabled || (() => true);

  const server = new Server(
    { name: 'desktop-mcp', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.filter((tool) => isToolEnabled(tool.name))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = TOOLS.find((candidate) => candidate.name === name);
    if (!tool) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`);

    if (!isToolEnabled(name)) {
      return { content: [{ type: 'text', text: disabledMessage(name) }], isError: true };
    }

    if (name === TOOL_NAMES.getScreenSize) {
      const info = await getScreenSize();
      return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
    }

    const { buffer, mimeType, meta } = await captureScreenshot(args || {});
    return {
      content: [
        { type: 'image', data: buffer.toString('base64'), mimeType },
        { type: 'text', text: JSON.stringify(meta, null, 2) }
      ]
    };
  });

  return server;
}

function disabledToolsFromEnv() {
  const raw = process.env.DESKTOP_MCP_DISABLED_TOOLS || '';
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

async function runStdio() {
  const disabled = disabledToolsFromEnv();
  const server = createServer({ isToolEnabled: (name) => !disabled.has(name) });
  await server.connect(new StdioServerTransport());
}

module.exports = { createServer, runStdio, TOOLS, TOOL_NAMES, disabledMessage };
