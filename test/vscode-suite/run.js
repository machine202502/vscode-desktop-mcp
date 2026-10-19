'use strict';

const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

(async () => {
  const extensionDevelopmentPath = path.join(__dirname, '..', '..');
  const extensionTestsPath = path.join(__dirname, 'index.js');
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions', '--disable-workspace-trust']
    });
  } catch (error) {
    console.error('E2E failed:', error);
    process.exit(1);
  }
})();
