import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  use: { baseURL: "http://localhost:4173/", ...devices["Pixel 7"], locale: "de-CH", timezoneId: "Europe/Zurich", launchOptions: { executablePath: process.env.CHROMIUM ?? undefined } },
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true },
  reporter: [["list"]],
});
