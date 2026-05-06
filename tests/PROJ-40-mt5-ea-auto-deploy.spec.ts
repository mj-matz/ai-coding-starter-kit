/**
 * E2E Tests for PROJ-40: MT5 EA Auto-Deploy
 *
 * Prerequisites: App running at http://localhost:3000, user authenticated.
 * Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local to enable the
 * auth step (the helper skips the test otherwise).
 *
 * Coverage (acceptance criteria from features/PROJ-40-*.md):
 *   - Settings page renders the new "EA Deployments" history section
 *   - History endpoint /api/mt5/ea/deployments is wired up to render rows
 *   - Failed/compile_error rows expand to show the compile log
 *   - MQL Converter exposes "Deploy to MT5" next to the existing
 *     "Export MT5 EA" button after a successful conversion
 *   - The button is disabled with the bridge-offline tooltip when the
 *     /api/mt5/health route reports offline
 *   - The confirm dialog opens on click and shows the EA name input
 *     plus the overwrite warning
 *   - Compile error response surfaces in the multi-line error dialog
 *     (not a toast)
 */

import { test, expect, type Page } from "@playwright/test";

// ── Auth helper (shared shape with other PROJ specs) ────────────────────────

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

// ── Network mocks ───────────────────────────────────────────────────────────

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

async function mockDeploymentsList(
  page: Page,
  deployments: Array<Record<string, unknown>>,
  totalOverride?: number,
) {
  // Honour `?offset=` so the pagination controls can drive multiple pages.
  await page.route("**/api/mt5/ea/deployments**", async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "10");
    const slice = deployments.slice(offset, offset + limit);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        deployments: slice,
        total: totalOverride ?? deployments.length,
        limit,
        offset,
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

// ── Settings page — EA Deployments section ──────────────────────────────────

test.describe("PROJ-40 — Settings: EA Deployments history", () => {
  test("renders the EA Deployments section heading", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await mockDeploymentsList(page, []);
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "EA Deployments" }),
    ).toBeVisible();
  });

  test("shows the empty state when there are no deployments", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await mockDeploymentsList(page, []);
    await page.goto("/settings");

    await expect(page.getByText("No EA deployments yet")).toBeVisible();
  });

  test("renders deployment rows with status badges (compiled, compile_error, timeout)", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await mockDeploymentsList(page, [
      {
        id: "11111111-1111-1111-1111-111111111111",
        ea_name: "BreakoutEA",
        source: "mql_converter",
        mql_conversion_id: null,
        optimizer_run_id: null,
        optimizer_result_rank: null,
        status: "compiled",
        error_message: null,
        warnings: [],
        errors: null,
        log_excerpt: null,
        deployed_at: new Date().toISOString(),
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        ea_name: "BrokenEA",
        source: "mql_converter",
        mql_conversion_id: null,
        optimizer_run_id: null,
        optimizer_result_rank: null,
        status: "compile_error",
        error_message: "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
        warnings: null,
        errors: [
          "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
        ],
        log_excerpt: "compile log line 1\ncompile log line 2",
        deployed_at: new Date().toISOString(),
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        ea_name: "SlowEA",
        source: "mql_converter",
        mql_conversion_id: null,
        optimizer_run_id: null,
        optimizer_result_rank: null,
        status: "timeout",
        error_message: "MetaEditor did not complete within 60s",
        warnings: null,
        errors: null,
        log_excerpt: null,
        deployed_at: new Date().toISOString(),
      },
    ]);
    await page.goto("/settings");

    await expect(page.getByText("BreakoutEA.mq5")).toBeVisible();
    await expect(page.getByText("BrokenEA.mq5")).toBeVisible();
    await expect(page.getByText("SlowEA.mq5")).toBeVisible();
    await expect(page.getByText("Compiled")).toBeVisible();
    await expect(page.getByText("Compile Error")).toBeVisible();
    await expect(page.getByText("Timeout")).toBeVisible();
  });

  test("expands a compile_error row to reveal the structured errors and log", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await mockDeploymentsList(page, [
      {
        id: "22222222-2222-2222-2222-222222222222",
        ea_name: "BrokenEA",
        source: "mql_converter",
        mql_conversion_id: null,
        optimizer_run_id: null,
        optimizer_result_rank: null,
        status: "compile_error",
        error_message: "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
        warnings: null,
        errors: [
          "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
          "BrokenEA.mq5(20,1): error: too many parameters",
        ],
        log_excerpt: "compile log first line\ncompile log second line",
        deployed_at: new Date().toISOString(),
      },
    ]);
    await page.goto("/settings");

    await page.getByText("BrokenEA.mq5").click();
    await expect(page.getByText("Compile Log")).toBeVisible();
    await expect(page.getByText("compile log first line")).toBeVisible();
    await expect(
      page.getByText("'foo' - undeclared identifier"),
    ).toBeVisible();
    await expect(page.getByText("too many parameters")).toBeVisible();
  });

  test("paginates with Previous / Next when there are more than 10 deployments", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    // 25 fixtures so the table has 3 pages of 10 (last page = 5 rows).
    const fixtures = Array.from({ length: 25 }).map((_, i) => ({
      id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, "0")}`,
      ea_name: `EA_${String(i).padStart(2, "0")}`,
      source: "mql_converter",
      mql_conversion_id: null,
      optimizer_run_id: null,
      optimizer_result_rank: null,
      status: "compiled",
      error_message: null,
      warnings: [],
      errors: null,
      log_excerpt: null,
      deployed_at: new Date(Date.now() - i * 60_000).toISOString(),
    }));
    await mockDeploymentsList(page, fixtures);
    await page.goto("/settings");

    // Page 1 — newest 10 visible, EA_00 at the top, EA_09 last.
    await expect(page.getByText("EA_00.mq5")).toBeVisible();
    await expect(page.getByText("EA_09.mq5")).toBeVisible();
    await expect(page.getByText("Page 1 / 3")).toBeVisible();
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();

    // Click Next → page 2.
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 2 / 3")).toBeVisible();
    await expect(page.getByText("EA_10.mq5")).toBeVisible();
    await expect(page.getByText("EA_19.mq5")).toBeVisible();

    // Next again → final page (5 rows), Next disabled.
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("Page 3 / 3")).toBeVisible();
    await expect(page.getByText("EA_24.mq5")).toBeVisible();
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});

// ── MQL Converter page — Deploy button ──────────────────────────────────────

test.describe("PROJ-40 — MQL Converter: Deploy to MT5 button", () => {
  test("button stays hidden until a conversion has produced a backtest", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    // No backtest yet → no Save & Export panel and no Deploy button.
    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).not.toBeVisible();
  });

  test("button is disabled with bridge-offline tooltip when bridge is offline", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, false);
    await page.goto("/mql-converter");

    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page.getByRole("button", { name: /convert.*backtest/i }).click();

    // After conversion the Save & Export panel appears.
    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeDisabled();

    // Hovering the disabled wrapper surfaces the offline tooltip.
    await page.getByRole("button", { name: /Deploy to MT5/i }).hover();
    await expect(
      page.getByText(/MT5 Bridge Worker is offline/i),
    ).toBeVisible();
  });

  test("button is enabled when the bridge is online", async ({ page }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page.getByRole("button", { name: /convert.*backtest/i }).click();

    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeEnabled();
  });

  test("opens the confirm dialog with EA name input and overwrite warning", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);
    await page.goto("/mql-converter");

    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page.getByRole("button", { name: /convert.*backtest/i }).click();

    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /Deploy to MT5/i }).click();

    await expect(
      page.getByRole("dialog").getByText("Deploy to MT5"),
    ).toBeVisible();
    await expect(page.getByLabel("EA Name")).toBeVisible();
    await expect(
      page.getByText(/An EA with this name will be overwritten/i),
    ).toBeVisible();
  });

  test("compile_error response opens the multi-line error dialog (not a toast)", async ({
    page,
  }) => {
    await loginIfNeeded(page);
    await mockBridgeHealth(page, true);

    // Mock the deploy endpoint to return a compile_error.
    await page.route("**/api/mt5/ea/deploy", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deployment_id: "33333333-3333-3333-3333-333333333333",
          status: "compile_error",
          ea_name: "BrokenEA",
          errors: [
            "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
            "BrokenEA.mq5(20,1): error: too many parameters",
          ],
          log_excerpt: "compile log line",
          error_message: "BrokenEA.mq5(17,3): error: 'foo' - undeclared identifier",
        }),
      });
    });

    await page.goto("/mql-converter");
    await page.locator("textarea").first().fill(MQL_SAMPLE);
    await page.getByRole("button", { name: /convert.*backtest/i }).click();

    await expect(
      page.getByRole("button", { name: /Deploy to MT5/i }),
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /Deploy to MT5/i }).click();
    await page.getByRole("button", { name: /^Deploy$/ }).click();

    await expect(
      page.getByRole("dialog").getByText("Compile Error"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/'foo' - undeclared identifier/),
    ).toBeVisible();
  });
});
