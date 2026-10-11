import { defineConfig } from '@playwright/test';

const SERVER_PORT = 8787;
const WEB_PORT = 8081;

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 400, height: 860 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `rm -f /tmp/bm-e2e.sqlite* && DB_PATH=/tmp/bm-e2e.sqlite PORT=${SERVER_PORT} npx tsx ../../server/src/node.ts`,
      port: SERVER_PORT,
      reuseExistingServer: false,
      cwd: __dirname,
    },
    { command: `PORT=${WEB_PORT} node serve.mjs`, port: WEB_PORT, reuseExistingServer: false, cwd: __dirname },
  ],
});
