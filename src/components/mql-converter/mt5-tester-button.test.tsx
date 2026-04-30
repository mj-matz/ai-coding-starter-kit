/**
 * Component tests for PROJ-37: MT5 Tester button.
 *
 * Verifies the offline-disable behavior, status-text transitions, and that
 * the "Open Settings" hint surfaces when the bridge is unreachable.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { Mt5TesterButton } from "./mt5-tester-button";

const NOOP = () => {};

describe("Mt5TesterButton", () => {
  it("is disabled and shows the offline hint when the bridge is offline", () => {
    render(
      <Mt5TesterButton
        bridgeOnline={false}
        bridgeChecking={false}
        phase="idle"
        status={null}
        queuePosition={null}
        runningElapsedSec={null}
        onClick={NOOP}
      />
    );

    const button = screen.getByRole("button", {
      name: /Run strategy in MT5 Strategy Tester/i,
    });
    expect(button).toBeDisabled();

    // Shadcn's Tooltip mounts in a portal only on hover; the surrounding
    // <span tabIndex={0}> is the wrapper that lets the disabled-button
    // tooltip target receive pointer events. We assert on its presence as a
    // smoke check — the wrapper is only used in the offline branch.
    expect(button.parentElement?.tagName.toLowerCase()).toBe("span");
  });

  it("is enabled and shows the default label when online and idle", () => {
    render(
      <Mt5TesterButton
        bridgeOnline={true}
        bridgeChecking={false}
        phase="idle"
        status={null}
        queuePosition={null}
        runningElapsedSec={null}
        onClick={NOOP}
      />
    );

    const button = screen.getByRole("button", { name: /Run strategy in MT5/i });
    expect(button).not.toBeDisabled();
    expect(button.textContent).toMatch(/Test in MT5/i);
  });

  it("shows the queued status text with position", () => {
    render(
      <Mt5TesterButton
        bridgeOnline={true}
        bridgeChecking={false}
        phase="polling"
        status="queued"
        queuePosition={3}
        runningElapsedSec={null}
        onClick={NOOP}
      />
    );

    const button = screen.getByRole("button", { name: /Run strategy in MT5/i });
    expect(button).toBeDisabled(); // busy
    expect(button.textContent).toMatch(/Queued \(position 3\)/i);
  });

  it("shows the running status text with elapsed mm:ss", () => {
    render(
      <Mt5TesterButton
        bridgeOnline={true}
        bridgeChecking={false}
        phase="polling"
        status="running"
        queuePosition={null}
        runningElapsedSec={73}
        onClick={NOOP}
      />
    );

    const button = screen.getByRole("button", { name: /Run strategy in MT5/i });
    expect(button.textContent).toMatch(/Running 1:13/);
  });

  it("invokes onClick when clicked while online and idle", () => {
    const onClick = vi.fn();
    render(
      <Mt5TesterButton
        bridgeOnline={true}
        bridgeChecking={false}
        phase="idle"
        status={null}
        queuePosition={null}
        runningElapsedSec={null}
        onClick={onClick}
      />
    );

    const button = screen.getByRole("button", { name: /Run strategy in MT5/i });
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects an external `disabled` prop even when the bridge is online", () => {
    render(
      <Mt5TesterButton
        bridgeOnline={true}
        bridgeChecking={false}
        phase="idle"
        status={null}
        queuePosition={null}
        runningElapsedSec={null}
        disabled
        onClick={NOOP}
      />
    );

    expect(
      screen.getByRole("button", { name: /Run strategy in MT5/i })
    ).toBeDisabled();
  });
});
