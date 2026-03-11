import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-gray-400">
          Welcome to Quanti Backtester
        </p>
      </div>

      <Card className="border-gray-800 bg-[#111118]">
        <CardHeader>
          <CardTitle className="text-gray-100">Welcome back</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400">
            Signed in as{" "}
            <span className="font-medium text-blue-400">
              {user?.email ?? "Unknown"}
            </span>
          </p>
          <p className="mt-4 text-sm text-gray-500">
            Use the sidebar to navigate between backtests, data sources,
            strategies, and your trade journal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
