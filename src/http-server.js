'use strict';

const http = require('node:http');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createServer } = require('./mcp-server');

const DEFAULT_PORT = 7841;
const DEFAULT_HOST = '127.0.0.1';

/**
 * Start the MCP server over Streamable HTTP (stateless mode).
 * @param {{port?: number, host?: string, isToolEnabled?: (name: string) => boolean}} [options]
 * @returns {Promise<{url: string, port: number, host: string, close: () => Promise<void>}>}
 */
async function startHttpServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port === undefined || options.port === null ? DEFAULT_PORT : Number(options.port);

  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'desktop-mcp' }));
      return;
    }

    if (req.url !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found, use /mcp' }));
      return;
    }

    // Stateless: a fresh server + transport per request keeps concurrent clients isolated.
    const server = createServer({ isToolEnabled: options.isToolEnabled });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  const actualPort = httpServer.address().port;
  return {
    url: `http://${host}:${actualPort}/mcp`,
    port: actualPort,
    host,
    close: () =>
      new Promise((resolve) => {
        httpServer.close(() => resolve());
      })
  };
}

module.exports = { startHttpServer, DEFAULT_PORT, DEFAULT_HOST };
