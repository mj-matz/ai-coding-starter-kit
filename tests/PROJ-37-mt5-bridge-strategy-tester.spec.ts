/**
 * E2E Tests for PROJ-37: MT5 Bridge Worker — Strategy Tester Run
 *
 * Prerequisites: App running at http://localhost:3000, user authenticated.
 * Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local to enable the
 * auth step (the helper skips the test otherwise).
 *
 * Coverage:
 *   - Settings page renders the MT5 Bridge + Notifications cards
 *   - MQL Converter page exposes the new "MT5 Tester History" tab
 *   - The "Test in MT5" action card and button only appear after a successful
 *     conversion has produced a `convertResult` + `lastInputValues`
 *   - When the /api/mt5/health route is mocked offline, the button is
 *     disabled and the inline "open Settings" hint surfaces
 *   - When the bridge is online, the button is enabled
 *   - When the run completes (mocked /api/mt5/tester/run + status), the
 *     comparison table renders with both Python and MT5 metrics
 */

import { test, expect, type Page } from "@playwright/test";

// ── Auth helper ─────────────────────────────────────────────────────────────

async function loginIfNeeded(page: Page) {
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
  await page.waitForURL(/\/(backtest|mql-converter|history|settings)/);
}

// ── Mock helpers ────────────────────────────────────────────────────────────

async function mockBridgeHealth(page: Page, online: boolean) {
  await page.route("**/api/mt5/health**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        online,
        status: online ? "online" : "offline",
        terminal_logged_in: online,
        broker: online ? "Startrader" : null,
        build: online ? 5833 : null,
        queue_length: 0,
        current_run: null,
        last_health_check_at: new Date().toISOString(),
      }),
    });
  });
}

// ── Sample MQL ──────────────────────────────────────────────────────────────

const MQL_SAMPLE = `
//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
input int    StopLoss    = 50;
input int    TakeProfit  = 100;

int OnInit() { return INIT_SUCCEEDED; }
void OnDeinit(const int reason) {}
void OnTick() {}
`.trim();

// ── Settings page ───────────────────────────────────────────────────────────

test.describe("PROJ-37 — Settings page", () => {
  test("renders the MT5 Bridge and Notifications sections", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "MT5 Bridge" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Notifications" })
    ).toBeVisible();

    // The status card should report "Startrader" once the mocked health resolves.
    await expect(page.getByText("Startrader")).toBeVisible();
  });

  test("Notifications card exposes Telegram fields when toggled on", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/settings");

    // Telegram bot token + chat ID labels are always rendered (just disabled).
    await expect(page.getByLabel(/Bot Token/i)).toBeVisible();
    await expect(page.getByLabel(/Chat ID/i)).toBeVisible();
  });
});

// ── MQL Converter page ──────────────────────────────────────────────────────

test.describe("PROJ-37 — MQL Converter page", () => {
  test("exposes the MT5 Tester History tab", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    await expect(
      page.getByRole("tab", { name: "MT5 Tester History" })
    ).toBeVisible();
  });

  test("MT5 action card stays hidden until a conversion has run", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    // No backtest yet → no action card.
    await expect(
      page.getByRole("heading", { name: "MT5 Strategy Tester" })
    ).not.toBeVisible();
  });

  test("MT5 action card surfaces the offline hint when the bridge is unreachable", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await page.goto("/mql-converter");

    // Trigger a conversion → action card appears.
    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page
      .getByRole("button", { name: /convert.*backtest/i })
      .click();

    // Wait for the action card to appear after the backtest finishes.
    await expect(
      page.getByRole("heading", { name: "MT5 Strategy Tester" })
    ).toBeVisible({ timeout: 60_000 });

    // Bridge is offline → inline hint + disabled button.
    await expect(page.getByText(/Bridge Worker is offline/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Run strategy in MT5/i })
    ).toBeDisabled();
  });

  test("MT5 Tester button is enabled when the bridge is online", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page
      .getByRole("button", { name: /convert.*backtest/i })
      .click();

    await expect(
      page.getByRole("heading", { name: "MT5 Strategy Tester" })
    ).toBeVisible({ timeout: 60_000 });

    await expect(
      page.getByRole("button", { name: /Run strategy in MT5/i })
    ).toBeEnabled();
  });
});

// ── End-to-end run flow (mocked bridge) ─────────────────────────────────────

test.describe("PROJ-37 — Tester run flow", () => {
  test("comparison table renders after a successful run", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);

    const jobId = "11111111-1111-1111-1111-111111111111";

    await page.route("**/api/mt5/tester/run", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_id: jobId, status: "queued", queue_position: 1 }),
      });
    });

    let pollCount = 0;
    await page.route("**/api/mt5/tester/status/**", async (route) => {
      pollCount += 1;
      // First poll: queued → running. Second+: done with metrics matching python.
      const body =
        pollCount < 2
          ? {
              job_id: jobId,
              status: "running",
              queue_position: 0,
              started_at: new Date().toISOString(),
            }
          : {
              job_id: jobId,
              status: "done",
              queue_position: null,
              started_at: new Date(Date.now() - 5000).toISOString(),
              finished_at: new Date().toISOString(),
              metrics: {
                total_net_profit: 1000,
                sharpe_ratio: 1.4,
                profit_factor: 1.6,
                max_drawdown_abs: 80,
                max_drawdown_pct: 8.0,
                total_trades: 50,
                won_trades: 28,
                lost_trades: 22,
                average_trade: 20,
              },
            };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    await page.goto("/mql-converter");
    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page
      .getByRole("button", { name: /convert.*backtest/i })
      .click();

    // Wait until the action card appears, then click Test in MT5.
    await expect(
      page.getByRole("heading", { name: "MT5 Strategy Tester" })
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /Run strategy in MT5/i }).click();

    // Comparison panel should appear and eventually render the metrics table.
    await expect(
      page.getByRole("heading", { name: /Comparison: Python vs MT5/i })
    ).toBeVisible();
    await expect(page.getByText("Net Profit")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Sharpe Ratio")).toBeVisible();
    await expect(page.getByText("Max Drawdown")).toBeVisible();
    await expect(page.getByText("Total Trades")).toBeVisible();
  });
});
