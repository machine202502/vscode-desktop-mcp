const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, '..', 'bin', 'desktop-mcp.js')]
  });
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  console.log('TOOLS:', tools.tools.map(t => t.name).join(', '));
  const size = await client.callTool({ name: 'get_screen_size', arguments: {} });
  console.log('SIZE:', size.content[0].text.replace(/\s+/g, ' ').slice(0, 160));
  const shot = await client.callTool({ name: 'capture_screenshot', arguments: { region: { x: 0, y: 0, width: 320, height: 200 }, format: 'jpeg', quality: 60 } });
  console.log('SHOT types:', shot.content.map(c => c.type).join(','), 'b64 len:', shot.content[0].data.length);
  await client.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
