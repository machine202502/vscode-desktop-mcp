'use strict';

const assert = require('node:assert');
const { upsertJson, upsertToml, hasTomlSection } = require('../src/agents');

// JSON: create, update, preserve unrelated keys
let json = upsertJson('', 'mcpServers', { type: 'http', url: 'http://127.0.0.1:7841/mcp' });
assert.deepStrictEqual(JSON.parse(json), {
  mcpServers: { 'desktop-mcp': { type: 'http', url: 'http://127.0.0.1:7841/mcp' } }
});

json = upsertJson(
  JSON.stringify({ mcpServers: { other: { url: 'x' }, 'desktop-mcp': { url: 'old' } }, theme: 'dark' }),
  'mcpServers',
  { type: 'http', url: 'http://127.0.0.1:7850/mcp' }
);
const parsed = JSON.parse(json);
assert.strictEqual(parsed.mcpServers['desktop-mcp'].url, 'http://127.0.0.1:7850/mcp');
assert.deepStrictEqual(parsed.mcpServers.other, { url: 'x' });
assert.strictEqual(parsed.theme, 'dark');

// TOML: append to empty file
let toml = upsertToml('', 'http://127.0.0.1:7841/mcp');
assert.ok(hasTomlSection(toml));
assert.match(toml, /\[mcp_servers\.desktop-mcp\]\nurl = "http:\/\/127\.0\.0\.1:7841\/mcp"\nenabled = true/);

// TOML: append after existing sections, keep them intact
toml = upsertToml('[cli]\ntheme = "dark"\n', 'http://127.0.0.1:7841/mcp');
assert.match(toml, /^\[cli\]\ntheme = "dark"\n\n\[mcp_servers\.desktop-mcp\]/);

// TOML: update url in place, keep other keys in the section
toml = upsertToml(
  '[mcp_servers.desktop-mcp]\nurl = "http://old/mcp"\nenabled = true\ncustom = 1\n\n[plugins]\nx = 1\n',
  'http://127.0.0.1:7850/mcp'
);
assert.match(toml, /url = "http:\/\/127\.0\.0\.1:7850\/mcp"/);
assert.match(toml, /custom = 1/);
assert.match(toml, /\[plugins\]\nx = 1/);
assert.strictEqual(toml.match(/\[mcp_servers\.desktop-mcp\]/g).length, 1);

// TOML: quoted section name is recognised
assert.ok(hasTomlSection('[mcp_servers."desktop-mcp"]\nurl = "x"\n'));

console.log('agents config OK: json + toml upsert');
