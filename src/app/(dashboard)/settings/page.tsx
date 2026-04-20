"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useMt5Data } from "@/hooks/use-mt5-data";
import { useDataCache, type CacheGroup } from "@/hooks/use-data-cache";
import { createClient } from "@/lib/supabase/client";

import { Mt5DataTable } from "@/components/settings/mt5-data-table";
import { Mt5UploadDialog } from "@/components/settings/mt5-upload-dialog";
import { CacheManagementTable } from "@/components/settings/cache-management-table";
import { AdminUserStrategiesTable } from "@/components/settings/admin-user-strategies-table";

import type { Mt5Timeframe, Mt5UploadRequest } from "@/lib/mt5-data-types";

export default function SettingsPage() {
  const { toast } = useToast();
  const { datasets, isLoading, error, upload, deleteDataset, findDataset } = useMt5Data();
  const { groups, isLoading: cacheLoading, error: cacheError, deleteGroup } = useDataCache();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const role = (data.session?.user?.app_metadata as Record<string, unknown>)?.role;
      setIsAdmin(role === "admin");
    });
  }, []);

  async function handleUpload(req: Mt5UploadRequest) {
    const res = await upload(req);
    toast({
      title: "Upload successful",
      description: `${res.dataset.candle_count.toLocaleString()} candles stored for ${res.dataset.asset} ${res.dataset.timeframe.toUpperCase()}.`,
    });
    return res;
  }

  async function handleDelete(id: string) {
    const ok = await deleteDataset(id);
    if (ok) {
      toast({
        title: "Dataset deleted",
        description: "The MT5 dataset has been removed.",
      });
    } else {
      toast({
        title: "Delete failed",
        description: "Could not delete the dataset. Please try again.",
        variant: "destructive",
      });
    }
    return ok;
  }

  async function handleCacheDelete(group: CacheGroup) {
    const ok = await deleteGroup(group);
    if (ok) {
      toast({
        title: "Cache deleted",
        description: `All chunks for ${group.symbol} ${group.timeframe.toUpperCase()} have been removed.`,
      });
    } else {
      toast({
        title: "Delete failed",
        description: "Could not delete all cache chunks. Please try again.",
        variant: "destructive",
      });
    }
    return ok;
  }

  const existsForAsset = (asset: string, timeframe: Mt5Timeframe): boolean => {
    return !!findDataset(asset, timeframe);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-gray-400">
          Manage application settings and imported broker data.
        </p>
      </div>

      {/* Section: Cache Management */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Cache Management</h2>
          <p className="mt-1 text-sm text-gray-400">
            Dukascopy data cached as monthly chunks on the server. Delete an asset to force a fresh download on the next backtest.
          </p>
        </div>
        <CacheManagementTable
          groups={groups}
          isLoading={cacheLoading}
          error={cacheError}
          onDelete={handleCacheDelete}
        />
      </section>

      {/* Section: Market Data (MT5) */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Market Data (MT5)</h2>
            <p className="mt-1 text-sm text-gray-400">
              Import MT5 History Center CSV exports so backtests with MT5 Mode use your broker&apos;s exact prices.
            </p>
          </div>
          <Button
            onClick={() => setUploadOpen(true)}
            className="bg-blue-600 text-white hover:bg-blue-500"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Upload CSV
          </Button>
        </div>

        <Mt5DataTable
          datasets={datasets}
          isLoading={isLoading}
          error={error}
          onDelete={handleDelete}
        />
      </section>

      <Mt5UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        existsForAsset={existsForAsset}
        onUpload={handleUpload}
      />

      {/* Section: User Strategies (admin only) */}
      {isAdmin && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">User Strategies</h2>
            <p className="mt-1 text-sm text-gray-400">
              All custom strategies saved by users from the MQL Converter.
            </p>
          </div>
          <AdminUserStrategiesTable />
        </section>
      )}
    </div>
  );
}
