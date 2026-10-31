import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Use a preinstalled Chromium when one is provided (e.g. CI images).
const executablePath = process.env.PW_CHROMIUM ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const shared = {
  baseURL: "http://localhost:5173",
  viewport: { width: 1440, height: 900 },
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  projects: [
    {
      name: "chromium",
      use: {
        ...shared,
        launchOptions: {
          executablePath,
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...shared,
        launchOptions: {
          firefoxUserPrefs: {
            "webgl.disabled": false,
            "webgl.force-enabled": true,
          },
        },
      },
    },
    { name: "webkit", use: { ...shared } },
  ],
  webServer: {
    command: "pnpm --filter @afterfall/web exec vite --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
