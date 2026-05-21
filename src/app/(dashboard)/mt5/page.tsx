"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Mt5BridgeStatusCard } from "@/components/settings/mt5-bridge-status-card";
import { StandaloneTesterForm } from "@/components/mt5/standalone-tester-form";
import type { TesterFormValues } from "@/components/mt5/standalone-tester-form";
import { TesterHistoryTable } from "@/components/mt5/tester-history-table";
import type { Mt5TesterRun } from "@/lib/mt5-bridge-types";

function runToFormValues(run: Mt5TesterRun): TesterFormValues {
  const parameters = run.parameters
    ? Object.entries(run.parameters).map(([key, value]) => ({
        key,
        value: String(value),
      }))
    : [];

  return {
    expertName: run.expert_name,
    symbol: run.symbol,
    timeframe: run.timeframe ?? "5m",
    fromDate: (run.from_date ?? "").slice(0, 10),
    toDate: (run.to_date ?? "").slice(0, 10),
    model: run.model ?? "EveryTickRealistic",
    parameters,
  };
}

function Mt5Hub() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = searchParams.get("tab") ?? "tester";

  function setActiveTab(tab: string) {
    router.replace(`${pathname}?tab=${tab}`);
  }

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  // `prefilledKey` forces StandaloneTesterForm to remount (and re-initialise)
  // whenever the user clicks "Use these settings" in the History drawer.
  const [prefilledKey, setPrefilledKey] = useState(0);
  const [prefilledValues, setPrefilledValues] = useState<TesterFormValues | null>(null);

  function handleUseSettings(run: Mt5TesterRun) {
    setPrefilledValues(runToFormValues(run));
    setPrefilledKey((k) => k + 1);
    setActiveTab("tester");
  }

  function handleRunComplete() {
    setHistoryRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">MT5 Hub</h1>
        <p className="mt-1 text-gray-400">
          Run strategies directly in MT5, review history, and monitor the bridge connection.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="border border-white/10 bg-white/5">
          <TabsTrigger
            value="tester"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            Tester
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            History
          </TabsTrigger>
          <TabsTrigger
            value="bridge"
            className="text-slate-400 data-[state=active]:bg-white/10 data-[state=active]:text-slate-100"
          >
            Bridge
          </TabsTrigger>
        </TabsList>

        {/* Tester tab */}
        <TabsContent value="tester" className="mt-6">
          <div className="max-w-2xl">
            <StandaloneTesterForm
              key={prefilledKey}
              initialValues={prefilledValues}
              onRunComplete={handleRunComplete}
            />
          </div>
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-6">
          <TesterHistoryTable
            refreshKey={historyRefreshKey}
            onUseSettings={handleUseSettings}
          />
        </TabsContent>

        {/* Bridge tab */}
        <TabsContent value="bridge" className="mt-6">
          <div className="max-w-xl">
            <Mt5BridgeStatusCard />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Mt5Page() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}>
      <Mt5Hub />
    </Suspense>
  );
}
