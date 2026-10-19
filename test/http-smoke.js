const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startHttpServer } = require('../src/http-server');

(async () => {
  const server = await startHttpServer({ port: 0 });
  console.log('listening:', server.url);

  const health = await fetch(server.url.replace('/mcp', '/health'));
  console.log('health:', health.status, await health.text());

  const client = new Client({ name: 'http-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  const tools = await client.listTools();
  console.log('tools:', tools.tools.map(t => t.name).join(', '));
  const size = await client.callTool({ name: 'get_screen_size', arguments: {} });
  console.log('size:', JSON.parse(size.content[0].text).virtualScreen);
  const shot = await client.callTool({ name: 'capture_screenshot', arguments: { region: { x: 0, y: 0, width: 200, height: 120 }, format: 'jpeg', quality: 50 } });
  console.log('shot:', shot.content[0].type, shot.content[0].data.length, 'b64 chars');
  await client.close();
  await server.close();
  console.log('HTTP OK');
})().catch(e => { console.error('ERR', e); process.exit(1); });
