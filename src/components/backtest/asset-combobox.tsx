"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface AssetOption {
  symbol: string;
  name: string;
  category: string;
}

interface AssetComboboxProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const RECENT_ASSETS_KEY = "backtest-recent-assets";
const MAX_RECENT = 5;

function loadRecentAssets(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ASSETS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentAsset(symbol: string): void {
  try {
    const current = loadRecentAssets().filter((s) => s !== symbol);
    const updated = [symbol, ...current].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_ASSETS_KEY, JSON.stringify(updated));
  } catch {
    // silently fail
  }
}

export function AssetCombobox({ value, onChange, disabled }: AssetComboboxProps) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => loadRecentAssets());
  const [query, setQuery] = useState("");

  // Fetch assets when popover opens (only once)
  useEffect(() => {
    if (!open || assets.length > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch("/api/data/assets")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load assets");
        return res.json() as Promise<AssetOption[]>;
      })
      .then((data) => setAssets(data))
      .catch(() => setError("Could not load asset list"))
      .finally(() => setLoading(false));
  }, [open, assets.length]);

  function handleSelect(symbol: string) {
    onChange(symbol);
    saveRecentAsset(symbol);
    setRecentSymbols(loadRecentAssets());
    setOpen(false);
    setQuery("");
  }

  // Group all assets by category for display
  const categories = Array.from(new Set(assets.map((a) => a.category))).sort();

  // Recent asset objects (resolved from loaded list or shown as symbol-only)
  const recentAssets = recentSymbols
    .map((sym) => assets.find((a) => a.symbol === sym) ?? { symbol: sym, name: "", category: "" })
    .filter(Boolean) as AssetOption[];

  const selectedAsset = assets.find((a) => a.symbol === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select asset"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between border-gray-700 bg-gray-900 px-3 font-normal text-gray-100 hover:bg-gray-800 hover:text-gray-100",
            !value && "text-gray-500"
          )}
        >
          <span className="truncate">
            {value
              ? selectedAsset
                ? `${selectedAsset.symbol} – ${selectedAsset.name}`
                : value
              : "Select asset…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0 border-gray-700 bg-gray-900"
        align="start"
      >
        <Command className="bg-gray-900">
          <CommandInput
            placeholder="Search symbol or name…"
            value={query}
            onValueChange={setQuery}
            className="border-gray-700 text-gray-100 placeholder:text-gray-500"
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {error && (
              <div className="py-4 text-center text-sm text-red-400">{error}</div>
            )}

            {!loading && !error && (
              <>
                <CommandEmpty className="py-4 text-center text-sm text-gray-400">
                  No asset found.
                </CommandEmpty>

                {/* Recent Assets — shown when no search query */}
                {!query && recentAssets.length > 0 && (
                  <>
                    <CommandGroup heading="Recent">
                      {recentAssets.map((asset) => (
                        <CommandItem
                          key={`recent-${asset.symbol}`}
                          value={`recent-${asset.symbol}`}
                          onSelect={() => handleSelect(asset.symbol)}
                          className="cursor-pointer text-gray-100 aria-selected:bg-gray-800"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === asset.symbol ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="font-medium">{asset.symbol}</span>
                          {asset.name && (
                            <span className="ml-2 text-gray-400">{asset.name}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandSeparator className="bg-gray-700" />
                  </>
                )}

                {/* All assets grouped by category */}
                {categories.map((category) => (
                  <CommandGroup key={category} heading={category}>
                    {assets
                      .filter((a) => a.category === category)
                      .map((asset) => (
                        <CommandItem
                          key={asset.symbol}
                          value={`${asset.symbol} ${asset.name}`}
                          onSelect={() => handleSelect(asset.symbol)}
                          className="cursor-pointer text-gray-100 aria-selected:bg-gray-800"
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === asset.symbol ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="font-medium">{asset.symbol}</span>
                          <span className="ml-2 text-gray-400">{asset.name}</span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
