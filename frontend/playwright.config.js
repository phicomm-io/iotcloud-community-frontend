import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  webServer: process.env.PHICOMM_WEB_URL ? undefined : {command:'npm run dev -- --host 127.0.0.1 --port 25173',url:'http://127.0.0.1:25173',reuseExistingServer:!process.env.CI},
  use: {
    baseURL: process.env.PHICOMM_WEB_URL || "http://127.0.0.1:25173",
    headless: true,
    channel: "chromium",
  },
  reporter: "list",
});
