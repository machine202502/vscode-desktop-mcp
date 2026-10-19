'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SERVER_NAME = 'desktop-mcp';

function configBasePath() {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32':
      return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    case 'darwin':
      return path.join(home, 'Library', 'Application Support');
    default:
      return process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  }
}

/**
 * Every supported MCP client. `detect` paths are used to decide whether the client
 * looks installed; the first existing config path wins.
 */
function getAgents() {
  const home = os.homedir();
  const base = configBasePath();
  const codeUser = path.join(base, 'Code', 'User');

  return [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(home, '.claude.json'),
      detect: [path.join(home, '.claude'), path.join(home, '.claude.json')],
      entry: (url) => ({ type: 'http', url })
    },
    {
      id: 'codex',
      displayName: 'Codex',
      format: 'toml',
      configPath: path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
      detect: [path.join(home, '.codex')]
    },
    {
      id: 'grok',
      displayName: 'Grok',
      format: 'toml',
      configPath: path.join(home, '.grok', 'config.toml'),
      detect: [path.join(home, '.grok')]
    },
    {
      id: 'copilot',
      displayName: 'GitHub Copilot (VS Code)',
      format: 'json',
      field: 'servers',
      configPath: path.join(codeUser, 'mcp.json'),
      detect: [codeUser],
      entry: (url) => ({ type: 'http', url })
    },
    {
      id: 'copilot-cli',
      displayName: 'GitHub Copilot CLI',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(process.env.COPILOT_HOME || path.join(home, '.copilot'), 'mcp-config.json'),
      detect: [path.join(home, '.copilot')],
      entry: (url) => ({ type: 'http', url, tools: ['*'] })
    },
    {
      id: 'cursor',
      displayName: 'Cursor',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(base, 'Cursor', 'User', 'globalStorage', 'cursor.mcp', 'settings', 'mcp_settings.json'),
      fallbackConfigPath: path.join(home, '.cursor', 'mcp.json'),
      detect: [path.join(base, 'Cursor'), path.join(home, '.cursor')],
      entry: (url) => ({ type: 'streamableHttp', url, autoApprove: [], disabled: false, timeout: 300 })
    },
    {
      id: 'cline',
      displayName: 'Cline',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(codeUser, 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      detect: [path.join(codeUser, 'globalStorage', 'saoudrizwan.claude-dev')],
      entry: (url) => ({ type: 'streamableHttp', url, autoApprove: [], disabled: false, timeout: 300 })
    },
    {
      id: 'roo',
      displayName: 'Roo Code',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(codeUser, 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'mcp_settings.json'),
      detect: [path.join(codeUser, 'globalStorage', 'rooveterinaryinc.roo-cline')],
      entry: (url) => ({ type: 'streamableHttp', url, autoApprove: [], disabled: false, timeout: 300 })
    },
    {
      id: 'windsurf',
      displayName: 'Windsurf',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      detect: [path.join(home, '.codeium', 'windsurf')],
      entry: (url) => ({ type: 'streamableHttp', url })
    },
    {
      id: 'antigravity',
      displayName: 'Antigravity',
      format: 'json',
      field: 'mcpServers',
      configPath: path.join(home, '.gemini', 'antigravity', 'mcp_config.json'),
      detect: [path.join(home, '.gemini', 'antigravity')],
      entry: (url) => ({ type: 'streamableHttp', url })
    }
  ];
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveConfigPath(agent) {
  if (await exists(agent.configPath)) return agent.configPath;
  if (agent.fallbackConfigPath && (await exists(agent.fallbackConfigPath))) return agent.fallbackConfigPath;
  return agent.configPath;
}

async function isInstalled(agent) {
  for (const candidate of agent.detect || []) {
    if (await exists(candidate)) return true;
  }
  return false;
}

async function isConfigured(agent) {
  const configPath = await resolveConfigPath(agent);
  if (!(await exists(configPath))) return false;
  try {
    const content = await fs.readFile(configPath, 'utf8');
    if (agent.format === 'toml') return hasTomlSection(content);
    const config = JSON.parse(content);
    return Boolean(config[agent.field] && config[agent.field][SERVER_NAME]);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- JSON */

function upsertJson(content, field, entry) {
  let config = {};
  if (content.trim()) config = JSON.parse(content);
  if (!config[field] || typeof config[field] !== 'object') config[field] = {};
  config[field][SERVER_NAME] = entry;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/* ------------------------------------------------------------------- TOML */

function escapeToml(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isSectionHeader(line) {
  return /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/.test(line);
}

function isOurSection(line) {
  return /^\s*\[mcp_servers\.(?:desktop-mcp|"desktop-mcp")\]\s*(?:#.*)?$/.test(line);
}

function hasTomlSection(content) {
  return content.replace(/\r\n/g, '\n').split('\n').some(isOurSection);
}

function upsertToml(content, url) {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const start = lines.findIndex(isOurSection);
  const body = [`url = "${escapeToml(url)}"`, 'enabled = true'];

  if (start === -1) {
    const separator = normalized.length === 0 ? '' : normalized.endsWith('\n') ? '\n' : '\n\n';
    return `${normalized}${separator}[mcp_servers.${SERVER_NAME}]\n${body.join('\n')}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isSectionHeader(lines[i])) {
      end = i;
      break;
    }
  }

  // Keep unrelated keys the user may have added, but always refresh url/enabled.
  const kept = lines.slice(start + 1, end).filter((line) => !/^\s*(url|enabled)\s*=/.test(line));
  const section = [lines[start], ...body, ...kept];
  return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n');
}

/* ---------------------------------------------------------------- install */

/**
 * Write (or refresh) the desktop-mcp entry in one agent's config.
 * @returns {Promise<{agent: object, configPath: string, created: boolean}>}
 */
async function installForAgent(agent, url) {
  const configPath = await resolveConfigPath(agent);
  const created = !(await exists(configPath));
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const current = created ? '' : await fs.readFile(configPath, 'utf8');
  const next =
    agent.format === 'toml' ? upsertToml(current, url) : upsertJson(current, agent.field, agent.entry(url));

  await fs.writeFile(configPath, next, 'utf8');
  return { agent, configPath, created };
}

/**
 * Remove the desktop-mcp entry from one agent's config.
 * @returns {Promise<boolean>} true when something was removed
 */
async function uninstallForAgent(agent) {
  const configPath = await resolveConfigPath(agent);
  if (!(await exists(configPath))) return false;

  const current = await fs.readFile(configPath, 'utf8');

  if (agent.format === 'toml') {
    if (!hasTomlSection(current)) return false;
    const lines = current.replace(/\r\n/g, '\n').split('\n');
    const start = lines.findIndex(isOurSection);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (isSectionHeader(lines[i])) {
        end = i;
        break;
      }
    }
    const next = [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n');
    await fs.writeFile(configPath, next, 'utf8');
    return true;
  }

  const config = JSON.parse(current);
  if (!config[agent.field] || !config[agent.field][SERVER_NAME]) return false;
  delete config[agent.field][SERVER_NAME];
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return true;
}

module.exports = {
  SERVER_NAME,
  getAgents,
  isInstalled,
  isConfigured,
  installForAgent,
  uninstallForAgent,
  upsertJson,
  upsertToml,
  hasTomlSection
};
