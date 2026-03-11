import { redirect } from "next/navigation";
import { Zap } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Check if user is already authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] px-4">
      <Card className="w-full max-w-md border-gray-800 bg-[#111118] shadow-2xl shadow-blue-950/20">
        <CardHeader className="space-y-4 pb-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600">
              <Zap className="h-6 w-6 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Quanti Backtester
            </h1>
            <p className="mt-1 text-sm text-gray-400">
              Sign in to your backtesting platform
            </p>
          </div>
        </CardHeader>

        <CardContent className="pt-4">
          {params.error === "auth_callback_failed" && (
            <div className="mb-4 rounded-md border border-red-500/50 bg-red-950/50 px-4 py-3 text-sm text-red-200">
              Authentication failed. Please try again.
            </div>
          )}
          <LoginForm returnTo={params.returnTo} />
        </CardContent>

        <CardFooter className="justify-center pb-6">
          <p className="text-xs text-gray-500">
            Contact your administrator for access
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
