import { defineConfig } from '@playwright/test';
const port = process.env.E2E_PORT || '4173';
const url = `http://127.0.0.1:${port}${process.env.BASE_PATH || '/'}`;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: url,
    browserName: 'chromium',
    channel: process.env.CI ? undefined : 'chrome',
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
