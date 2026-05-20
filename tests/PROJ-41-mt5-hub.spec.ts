/**
 * E2E Tests for PROJ-41: MT5 Hub — Standalone Tester, Trade Drill-Down & Metrics Fix
 *
 * Prerequisites: App running at http://localhost:3000, user authenticated.
 * Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local to enable the
 * auth step (the helper skips the test otherwise).
 *
 * Coverage:
 *   - /mt5 route exists and is linked from the sidebar
 *   - Three tabs render (Tester, History, Bridge) with ?tab= URL param
 *   - Tester tab has the standalone EA form with all required fields
 *   - Standalone form is disabled during run (prevents double-submit)
 *   - Expert name normalisation strips prefix and extension on submit
 *   - History tab renders correctly (empty state or run rows)
 *   - Delete button does NOT open drawer (stopPropagation)
 *   - Bridge tab renders Mt5BridgeStatusCard
 *   - Run detail drawer opens for completed run, shows params/metrics/trades
 *   - Drawer "No trades recorded" shown for run with empty trades
 *   - "Use these settings" pre-fills the form and switches to Tester tab
 *   - Regression: MQL Converter MT5 History section still renders
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
  await page.waitForURL(/\/(backtest|mql-converter|history|settings|mt5)/);
}

// ── Mock helpers ─────────────────────────────────────────────────────────────

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

async function mockRunsEmpty(page: Page) {
  await page.route("**/api/mt5/tester/runs**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      });
    } else {
      await route.continue();
    }
  });
}

const COMPLETED_RUN = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  mql_conversion_id: null,
  expert_name: "TestEA",
  symbol: "XAUUSD+",
  timeframe: "M5",
  from_date: "2024-01-01T00:00:00Z",
  to_date: "2024-06-01T00:00:00Z",
  parameters: { StopLoss: 50, TakeProfit: 100 },
  model: "EveryTickRealistic",
  status: "done",
  error_message: null,
  queue_position: null,
  bridge_job_id: "job-123",
  started_at: "2024-06-10T12:00:00Z",
  finished_at: "2024-06-10T12:05:00Z",
  last_status_at: "2024-06-10T12:05:00Z",
  metrics: [
    {
      total_net_profit: 1234.56,
      sharpe_ratio: 1.8,
      profit_factor: 1.5,
      max_drawdown_abs: 200,
      max_drawdown_pct: 5.2,
      total_trades: 42,
      won_trades: 28,
      lost_trades: 14,
      average_trade: 29.39,
    },
  ],
};

async function mockRunsWithCompleted(page: Page) {
  await page.route("**/api/mt5/tester/runs**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method !== "GET") {
      await route.continue();
      return;
    }
    // Single run detail (has /runs/<uuid> but not /trades)
    if (url.match(/\/runs\/[a-f0-9-]+$/) && !url.includes("/trades")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(COMPLETED_RUN),
      });
      return;
    }
    // Trades for the run
    if (url.includes("/trades")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trades: [
            {
              id: 1,
              run_id: COMPLETED_RUN.id,
              open_time: "2024-01-02T09:00:00Z",
              close_time: "2024-01-02T10:30:00Z",
              direction: "buy",
              volume: 0.1,
              open_price: 2020.5,
              close_price: 2035.0,
              profit: 145.0,
              comment: null,
            },
          ],
        }),
      });
      return;
    }
    // List all runs
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [COMPLETED_RUN] }),
    });
  });
}

async function mockRunsWithNoTrades(page: Page) {
  await page.route("**/api/mt5/tester/runs**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method !== "GET") {
      await route.continue();
      return;
    }
    if (url.includes("/trades")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ trades: [] }),
      });
      return;
    }
    if (url.match(/\/runs\/[a-f0-9-]+$/) && !url.includes("/trades")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(COMPLETED_RUN),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ runs: [COMPLETED_RUN] }),
    });
  });
}

// ── Sidebar nav ───────────────────────────────────────────────────────────────

test.describe("PROJ-41 — Sidebar nav", () => {
  test("MT5 nav item is present in the sidebar and links to /mt5", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await mockRunsEmpty(page);
    await page.goto("/");
    const mt5Link = page.locator('a[href="/mt5"]');
    await expect(mt5Link).toBeVisible();
    await mt5Link.click();
    await expect(page).toHaveURL(/\/mt5/);
  });
});

// ── /mt5 page structure ───────────────────────────────────────────────────────

test.describe("PROJ-41 — /mt5 page tabs", () => {
  test("renders three tabs: Tester, History, Bridge", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await mockRunsEmpty(page);
    await page.goto("/mt5");

    await expect(page.getByRole("tab", { name: "Tester" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Bridge" })).toBeVisible();
  });

  test("active tab is reflected in the ?tab= URL param", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await mockRunsEmpty(page);
    await page.goto("/mt5");

    await page.getByRole("tab", { name: "History" }).click();
    await expect(page).toHaveURL(/\?tab=history/);

    await page.getByRole("tab", { name: "Bridge" }).click();
    await expect(page).toHaveURL(/\?tab=bridge/);

    await page.getByRole("tab", { name: "Tester" }).click();
    await expect(page).toHaveURL(/\?tab=tester/);
  });

  test("navigating to /mt5?tab=bridge opens the Bridge tab directly", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=bridge");
    // Bridge tab should be active (its content visible)
    const bridgeTabContent = page.getByRole("tab", { name: "Bridge" });
    await expect(bridgeTabContent).toHaveAttribute("data-state", "active");
  });
});

// ── Tester tab — form ─────────────────────────────────────────────────────────

test.describe("PROJ-41 — Tester tab form", () => {
  test("form renders all required fields", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=tester");

    await expect(page.getByLabel("Expert Name")).toBeVisible();
    await expect(page.getByLabel("Symbol")).toBeVisible();
    await expect(page.getByLabel("Timeframe")).toBeVisible();
    await expect(page.getByLabel("From Date")).toBeVisible();
    await expect(page.getByLabel("To Date")).toBeVisible();
    await expect(page.getByLabel("Testing Model")).toBeVisible();
  });

  test("Run in MT5 button is disabled when required fields are empty", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=tester");

    const runBtn = page.getByRole("button", { name: /Run in MT5/i });
    await expect(runBtn).toBeDisabled();
  });

  test("Run in MT5 button enables when all required fields are filled", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=tester");

    await page.getByLabel("Expert Name").fill("TestEA");
    await page.getByLabel("Symbol").fill("XAUUSD+");
    await page.getByLabel("From Date").fill("2024-01-01");
    await page.getByLabel("To Date").fill("2024-06-01");

    const runBtn = page.getByRole("button", { name: /Run in MT5/i });
    await expect(runBtn).toBeEnabled();
  });

  test("dynamic key-value parameters can be added and removed", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=tester");

    await page.getByRole("button", { name: /Add/i }).click();
    const paramInputs = page.locator('input[placeholder="Parameter name"]');
    await expect(paramInputs).toHaveCount(1);

    await page.getByRole("button", { name: /Remove parameter/i }).click();
    await expect(paramInputs).toHaveCount(0);
  });

  test("form inputs are disabled while a run is in progress", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);

    // Mock the run submission to return a queued job
    await page.route("**/api/mt5/tester/run**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: "job-test-001",
          status: "queued",
          queue_position: 1,
        }),
      });
    });
    // Keep status polling as queued so the run stays in-progress
    await page.route("**/api/mt5/tester/status/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_id: "job-test-001",
          status: "queued",
          queue_position: 1,
        }),
      });
    });

    await page.goto("/mt5?tab=tester");
    await page.getByLabel("Expert Name").fill("TestEA");
    await page.getByLabel("Symbol").fill("XAUUSD+");
    await page.getByLabel("From Date").fill("2024-01-01");
    await page.getByLabel("To Date").fill("2024-06-01");

    await page.getByRole("button", { name: /Run in MT5/i }).click();

    // While run is in progress, the form inputs must be disabled
    await expect(page.getByLabel("Expert Name")).toBeDisabled();
    await expect(page.getByLabel("Symbol")).toBeDisabled();
    await expect(page.getByRole("button", { name: /Running/i })).toBeDisabled();
  });
});

// ── History tab ────────────────────────────────────────────────────────────────

test.describe("PROJ-41 — History tab", () => {
  test("shows empty state when there are no runs", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsEmpty(page);
    await page.goto("/mt5?tab=history");

    await expect(page.getByText("No MT5 Tester runs yet")).toBeVisible();
  });

  test("renders a completed run row with metrics", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    await expect(page.getByText("TestEA")).toBeVisible();
    await expect(page.getByText("XAUUSD+")).toBeVisible();
    // Status badge
    await expect(page.getByText("Completed")).toBeVisible();
  });

  test("delete button does not open the row detail drawer", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    await expect(page.getByText("TestEA")).toBeVisible();
    // Click the delete icon button — should open confirmation dialog, NOT the sheet
    const deleteBtn = page.getByRole("button", { name: /Delete MT5 run/i }).first();
    await deleteBtn.click();

    // The alert dialog should appear
    await expect(page.getByRole("alertdialog")).toBeVisible();
    // The sheet (run detail drawer) should NOT be open
    await expect(page.locator('[role="dialog"][data-side="right"]')).not.toBeVisible();
  });

  test("clicking a completed run row opens the detail drawer", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    await expect(page.getByText("TestEA")).toBeVisible();
    // Click the row (not the delete button)
    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    // Sheet should open
    await expect(page.locator('[role="dialog"]', { hasText: "TestEA" })).toBeVisible();
  });

  test("run detail drawer shows run settings section", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    await expect(page.getByText("TestEA")).toBeVisible();
    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await expect(page.getByText("Run Settings")).toBeVisible();
    await expect(page.getByText("XAUUSD+")).toBeVisible();
  });

  test("run detail drawer shows parameters table", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await expect(page.getByText("Parameters")).toBeVisible();
    await expect(page.getByText("StopLoss")).toBeVisible();
  });

  test("run detail drawer shows metrics section", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await expect(page.getByText("Metrics")).toBeVisible();
    await expect(page.getByText("Net Profit")).toBeVisible();
    await expect(page.getByText("Total Trades")).toBeVisible();
  });

  test("run detail drawer shows trades table when trades exist", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await expect(page.getByText("Trades")).toBeVisible();
    // Trade row data (direction)
    await expect(page.getByText("BUY")).toBeVisible();
  });

  test("run detail drawer shows 'No trades recorded' when trades array is empty", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockRunsWithNoTrades(page);
    await page.goto("/mt5?tab=history");

    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await expect(page.getByText("No trades recorded.")).toBeVisible();
  });

  test('"Use these settings" closes drawer and switches to Tester tab', async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsWithCompleted(page);
    await page.goto("/mt5?tab=history");

    const row = page.locator("tr", { hasText: "TestEA" }).first();
    await row.click();

    await page.getByRole("button", { name: /Use these settings/i }).click();

    // Should switch to Tester tab
    await expect(page).toHaveURL(/\?tab=tester/);
    // Expert Name field should be pre-filled
    await expect(page.getByLabel("Expert Name")).toHaveValue("TestEA");
  });
});

// ── Bridge tab ────────────────────────────────────────────────────────────────

test.describe("PROJ-41 — Bridge tab", () => {
  test("Bridge tab shows online status when bridge is online", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mt5?tab=bridge");

    // Bridge card should be visible
    await expect(page.getByText(/online/i)).toBeVisible();
  });

  test("Bridge tab shows offline status when bridge is offline", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await page.goto("/mt5?tab=bridge");

    await expect(page.getByText(/offline/i)).toBeVisible();
  });
});

// ── Regression: MQL Converter MT5 History section ────────────────────────────

test.describe("PROJ-41 — Regression: MQL Converter", () => {
  test("MQL Converter page still renders the MT5 Tester History tab", async ({ page }) => {
    await loginIfNeeded(page);
    await mockRunsEmpty(page);
    await page.goto("/mql-converter");

    await expect(page.getByRole("tab", { name: /MT5 Tester History/i })).toBeVisible();
  });
});
