const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');
const installed = path.join(process.env.USERPROFILE, '.vscode', 'extensions', 'local.desktop-mcp-0.1.0', 'bin', 'desktop-mcp.js');
(async () => {
  const client = new Client({ name: 'installed-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [installed] }));
  const tools = await client.listTools();
  console.log('installed tools:', tools.tools.map(t => t.name).join(', '));
  const shot = await client.callTool({ name: 'capture_screenshot', arguments: { display: 0, format: 'jpeg', quality: 50 } });
  console.log('installed capture:', shot.content[0].type, shot.content[0].data.length, 'b64 chars');
  await client.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
