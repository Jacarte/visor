import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/ui', use: { channel: process.env.PLAYWRIGHT_CHANNEL, baseURL: 'http://127.0.0.1:5173', viewport: { width: 1500, height: 1000 } }, webServer: {
  command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI
} });
