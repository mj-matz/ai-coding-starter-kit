"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import type { UserStrategy } from "@/lib/strategy-types";

export function AdminUserStrategiesTable() {
  const [strategies, setStrategies] = useState<UserStrategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/user-strategies?admin=true");
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const data = await res.json();
        setStrategies(data.strategies ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load user strategies");
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading user strategies…
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-sm text-red-400">{error}</p>;
  }

  if (strategies.length === 0) {
    return <p className="py-8 text-sm text-gray-500">No user strategies have been created yet.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="text-gray-400 font-medium">Name</TableHead>
            <TableHead className="text-gray-400 font-medium">Owner</TableHead>
            <TableHead className="text-gray-400 font-medium text-center">Params</TableHead>
            <TableHead className="text-gray-400 font-medium">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {strategies.map((s) => {
            const pc = Object.keys(s.parameter_schema?.properties ?? {}).length;
            return (
              <TableRow key={s.id} className="border-white/5 hover:bg-white/5">
                <TableCell className="text-sm text-white">
                  <div className="flex items-center gap-2">
                    {s.name}
                    <Badge className="bg-blue-900/50 text-blue-300 border-blue-800/50 hover:bg-blue-900/50 text-xs">
                      Custom
                    </Badge>
                  </div>
                  {s.description && (
                    <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{s.description}</p>
                  )}
                </TableCell>
                <TableCell className="text-xs text-gray-400 font-mono">
                  {s.user_id ? `${s.user_id.slice(0, 8)}…` : "—"}
                </TableCell>
                <TableCell className="text-center text-sm text-gray-300">{pc}</TableCell>
                <TableCell className="text-xs text-gray-500">
                  {new Date(s.created_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
