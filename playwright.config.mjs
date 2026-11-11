import { defineConfig } from '@playwright/test';

const port = Number(process.env.SPLICE_TEST_PORT ?? 49372);
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: url,
    channel: process.env.SPLICE_BROWSER || undefined,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
});
