#!/usr/bin/env node
'use strict';

const { runStdio } = require('../src/mcp-server');
const { startHttpServer, DEFAULT_PORT, DEFAULT_HOST } = require('../src/http-server');

function disabledTools() {
  return new Set(
    (process.env.DESKTOP_MCP_DISABLED_TOOLS || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  );
}

function parseArgs(argv) {
  const args = { http: false, port: DEFAULT_PORT, host: DEFAULT_HOST };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--http') args.http = true;
    else if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg.startsWith('--port=')) args.port = Number(arg.slice('--port='.length));
    else if (arg === '--host') args.host = argv[++i];
    else if (arg.startsWith('--host=')) args.host = arg.slice('--host='.length);
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`desktop-mcp — screen size and screenshots over MCP

Usage:
  desktop-mcp                 speak MCP over stdio (default)
  desktop-mcp --http          serve MCP over HTTP at http://${DEFAULT_HOST}:${DEFAULT_PORT}/mcp
  desktop-mcp --http --port 7841 --host 127.0.0.1`);
  process.exit(0);
}

if (args.http) {
  const disabled = disabledTools();
  startHttpServer({ port: args.port, host: args.host, isToolEnabled: (name) => !disabled.has(name) })
    .then(({ url }) => {
      console.error(`desktop-mcp: listening on ${url}`);
    })
    .catch((error) => {
      console.error(`desktop-mcp: ${error && error.stack ? error.stack : error}`);
      process.exit(1);
    });
} else {
  runStdio().catch((error) => {
    console.error(`desktop-mcp: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
  });
}
