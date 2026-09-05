import { defineConfig } from '@playwright/test';
import path from 'node:path';
const dir = path.join(process.cwd(), 'test-results', 'e2e-database');
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  reporter: 'list',
  globalSetup: './e2e/setup.ts',
  use: {
    baseURL: 'http://localhost:3100',
    contextOptions: { reducedMotion: 'reduce' },
    actionTimeout: 15000,
    headless: true,
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --webpack -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_URL: 'http://localhost:3100',
      PGLITE_DATA_DIR: dir,
      UPLOAD_DIR: path.join(process.cwd(), 'test-results', 'e2e-uploads'),
      E2E_TEST_MODE: 'true',
    },
  },
});
