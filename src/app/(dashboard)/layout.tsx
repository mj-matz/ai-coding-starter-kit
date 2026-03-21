import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/auth/app-sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const userRole = (user.user_metadata?.role as string) ?? "admin";

  return (
    <SidebarProvider>
      <AppSidebar userEmail={user.email ?? "Unknown"} userRole={userRole} />
      <main className="flex flex-1 flex-col">
        <header className="flex h-12 items-center border-b border-white/5 px-4">
          <SidebarTrigger className="text-slate-400 hover:text-white" />
        </header>
        <div className="flex-1 p-6">{children}</div>
      </main>
    </SidebarProvider>
  );
}
