import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 90000, expect: { timeout: 15000 }, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5187', browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 5187 --strictPort', url: 'http://127.0.0.1:5187/@vite/client', reuseExistingServer: !process.env.CI },
});
