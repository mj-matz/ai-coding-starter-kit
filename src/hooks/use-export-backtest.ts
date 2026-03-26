"use client";

import { useState } from "react";
import type { BacktestResult } from "@/lib/backtest-types";

export function useExportBacktest() {
  const [isExporting, setIsExporting] = useState(false);

  async function exportExcel(
    result: BacktestResult,
    startDate: string,
    endDate: string
  ) {
    setIsExporting(true);
    try {
      const XLSX = await import("xlsx");

      // Sheet 1: Trades & Skipped Days — merged, sorted chronologically
      type TradeRow = {
        id: number | string;
        date: string;
        entry_time: string;
        exit_time: string;
        direction: string;
        entry_price: number | string;
        exit_price: number | string;
        lot_size: number | string;
        pnl_pips: number | string;
        pnl_currency: number | string;
        r_multiple: number | string;
        exit_reason: string;
        duration_minutes: number | string;
        mae_pips: number | string;
        range_high: number | string;
        range_low: number | string;
        stop_loss: number | string;
        take_profit: number | string;
        entry_gap_pips: number | string;
        exit_gap: boolean | string;
        used_1s_resolution: boolean | string;
        reason: string;
      };

      const tradeRows: TradeRow[] = result.trades.map((t) => ({
        id: t.id,
        date: t.entry_time.slice(0, 10),
        entry_time: t.entry_time,
        exit_time: t.exit_time,
        direction: t.direction,
        entry_price: t.entry_price,
        exit_price: t.exit_price,
        lot_size: t.lot_size,
        pnl_pips: t.pnl_pips,
        pnl_currency: t.pnl_currency,
        r_multiple: t.r_multiple,
        exit_reason: t.exit_reason,
        duration_minutes: t.duration_minutes,
        mae_pips: t.mae_pips,
        range_high: t.range_high,
        range_low: t.range_low,
        stop_loss: t.stop_loss,
        take_profit: t.take_profit,
        entry_gap_pips: t.entry_gap_pips,
        exit_gap: t.exit_gap,
        used_1s_resolution: t.used_1s_resolution,
        reason: "",
      }));

      const skippedRows: TradeRow[] = (result.skipped_days ?? []).map((s) => ({
        id: "",
        date: s.date,
        entry_time: "",
        exit_time: "",
        direction: "",
        entry_price: "",
        exit_price: "",
        lot_size: "",
        pnl_pips: "",
        pnl_currency: "",
        r_multiple: "",
        exit_reason: "",
        duration_minutes: "",
        mae_pips: "",
        range_high: "",
        range_low: "",
        stop_loss: "",
        take_profit: "",
        entry_gap_pips: "",
        exit_gap: "",
        used_1s_resolution: "",
        reason: s.reason,
      }));

      const combinedRows = [...tradeRows, ...skippedRows].sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      // Sheet 2: Metrics as key-value table
      const metricsRows = Object.entries(result.metrics).map(
        ([key, value]) => ({ Kennzahl: key, Wert: value })
      );

      // Sheet 3: Monthly Summary
      const monthlyRows = result.monthly_r.map((m) => ({
        Monat: m.month,
        "Trade-Anzahl": m.trade_count,
        "Winrate %": m.win_rate_pct,
        R: m.r_earned ?? "",
        "Avg Loss Pips": m.avg_loss_pips ?? "",
        "Avg MAE Pips": m.avg_mae_pips ?? "",
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(combinedRows),
        "Trades & Skipped Days"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(metricsRows),
        "Metriken"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(monthlyRows),
        "Monthly Summary"
      );

      const xlsxData = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([xlsxData], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backtest_${result.symbol}_${startDate}_${endDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  function exportCsv(
    result: BacktestResult,
    startDate: string,
    endDate: string
  ) {
    setIsExporting(true);
    try {
      const headers = [
        "id",
        "date",
        "entry_time",
        "exit_time",
        "direction",
        "entry_price",
        "exit_price",
        "lot_size",
        "pnl_pips",
        "pnl_currency",
        "r_multiple",
        "exit_reason",
        "duration_minutes",
        "mae_pips",
        "range_high",
        "range_low",
        "stop_loss",
        "take_profit",
        "entry_gap_pips",
        "exit_gap",
        "used_1s_resolution",
        "reason",
      ];

      type CsvRow = { date: string; values: (string | number | boolean | null)[] };

      const tradesCsvRows: CsvRow[] = result.trades.map((t) => ({
        date: t.entry_time.slice(0, 10),
        values: [
          t.id,
          t.entry_time.slice(0, 10),
          t.entry_time,
          t.exit_time,
          t.direction,
          t.entry_price,
          t.exit_price,
          t.lot_size,
          t.pnl_pips,
          t.pnl_currency,
          t.r_multiple,
          t.exit_reason,
          t.duration_minutes,
          t.mae_pips,
          t.range_high,
          t.range_low,
          t.stop_loss,
          t.take_profit,
          t.entry_gap_pips,
          t.exit_gap,
          t.used_1s_resolution,
          "",
        ],
      }));

      const skippedCsvRows: CsvRow[] = (result.skipped_days ?? []).map(
        (s) => ({
          date: s.date,
          values: [
            "",
            s.date,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            s.reason,
          ],
        })
      );

      const allRows = [...tradesCsvRows, ...skippedCsvRows]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(({ values }) => values);

      function escapeCsv(v: string | number | boolean | null): string {
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }

      const csvContent = [
        headers.join(","),
        ...allRows.map((row) => row.map(escapeCsv).join(",")),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trades_${result.symbol}_${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }

  return { exportExcel, exportCsv, isExporting };
}
