/**
 * E2E Tests for PROJ-33: MQL Converter – MT5 EA Export
 *
 * Prerequisites: App running at http://localhost:3000, user authenticated.
 * These tests cover the acceptance criteria for the Export MT5 EA feature.
 *
 * Note: Full E2E runs require a logged-in session. Set TEST_USER_EMAIL and
 * TEST_USER_PASSWORD in .env.local to enable the auth step.
 */

import { test, expect } from "@playwright/test";

const MQL_SAMPLE = `
//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
input int    StopLoss    = 50;
input int    TakeProfit  = 100;
input double RiskPercent = 1.5;
input string TimeEntry   = "09:00";
input string TimeExit    = "20:00";

int OnInit() { return INIT_SUCCEEDED; }
void OnDeinit(const int reason) {}
void OnTick() {}
`.trim();

// Helper: log in before tests that need auth
async function loginIfNeeded(page: import("@playwright/test").Page) {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    test.skip();
    return;
  }
  await page.goto("/login");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(backtest|mql-converter|history)/);
}

// AC: Export button state before backtest
test("Export button is not visible before a backtest result", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");
  // The Save & Export section should NOT be rendered yet
  await expect(page.getByText("Export MT5 EA")).not.toBeVisible();
});

// AC: Export button disabled when no original MQL code in session
test("Export button shows disabled tooltip when originalMqlCode is missing", async ({ page }) => {
  await loginIfNeeded(page);
  // This scenario is hard to trigger in a clean E2E test (requires session manipulation).
  // Covered by unit/code review: canExport = !!originalMqlCode, disabled={!canExport}
  test.fixme(true, "Requires simulated session without originalMqlCode");
});

// AC: Export button appears after successful backtest
test("Export button is enabled and visible after a successful backtest", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");

  // Paste MQL code
  const mqlTextarea = page.locator("textarea").first();
  await mqlTextarea.fill(MQL_SAMPLE);

  // Fill in backtest settings (minimal)
  const symbolInput = page.getByLabel(/symbol/i).first();
  await symbolInput.fill("EURUSD");

  // Submit the form
  await page.getByRole("button", { name: /convert.*backtest/i }).click();

  // Wait for backtest to complete (up to 60s)
  await expect(page.getByText("Export MT5 EA")).toBeVisible({ timeout: 60_000 });

  // Button should be enabled
  const exportBtn = page.getByRole("button", { name: /Export MT5 EA/i });
  await expect(exportBtn).toBeEnabled();
});

// AC: Download starts on click, file is a .mq5 file
test("Clicking Export MT5 EA triggers a .mq5 file download", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");

  const mqlTextarea = page.locator("textarea").first();
  await mqlTextarea.fill(MQL_SAMPLE);

  const symbolInput = page.getByLabel(/symbol/i).first();
  await symbolInput.fill("EURUSD");

  await page.getByRole("button", { name: /convert.*backtest/i }).click();
  await expect(page.getByText("Export MT5 EA")).toBeVisible({ timeout: 60_000 });

  // Listen for download
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MT5 EA/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.mq5$/);
});

// AC: Filename includes symbol and date
test("Downloaded filename contains symbol and current date", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");

  const mqlTextarea = page.locator("textarea").first();
  await mqlTextarea.fill(MQL_SAMPLE);

  const symbolInput = page.getByLabel(/symbol/i).first();
  await symbolInput.fill("EURUSD");

  await page.getByRole("button", { name: /convert.*backtest/i }).click();
  await expect(page.getByText("Export MT5 EA")).toBeVisible({ timeout: 60_000 });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MT5 EA/i }).click();
  const download = await downloadPromise;

  const today = new Date().toISOString().split("T")[0];
  expect(download.suggestedFilename()).toContain("EURUSD");
  expect(download.suggestedFilename()).toContain(today);
});

// AC: Export is available after save (saved-success state)
test("Export button remains visible after saving a conversion", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");

  const mqlTextarea = page.locator("textarea").first();
  await mqlTextarea.fill(MQL_SAMPLE);

  const symbolInput = page.getByLabel(/symbol/i).first();
  await symbolInput.fill("EURUSD");

  await page.getByRole("button", { name: /convert.*backtest/i }).click();
  await expect(page.getByText("Export MT5 EA")).toBeVisible({ timeout: 60_000 });

  // Save the conversion
  const nameInput = page.getByPlaceholder(/enter a name/i);
  await nameInput.fill("Test Export QA");
  await page.getByRole("button", { name: /^Save$/i }).click();
  await expect(page.getByText("Conversion saved successfully")).toBeVisible({ timeout: 5_000 });

  // Export button should still be visible in the saved-success state
  await expect(page.getByRole("button", { name: /Export MT5 EA/i })).toBeVisible();
});

// AC: Section header is "Save & Export"
test("Action section heading is 'Save & Export'", async ({ page }) => {
  await loginIfNeeded(page);
  await page.goto("/mql-converter");

  const mqlTextarea = page.locator("textarea").first();
  await mqlTextarea.fill(MQL_SAMPLE);

  const symbolInput = page.getByLabel(/symbol/i).first();
  await symbolInput.fill("EURUSD");

  await page.getByRole("button", { name: /convert.*backtest/i }).click();
  await expect(page.getByText("Save & Export")).toBeVisible({ timeout: 60_000 });
});
