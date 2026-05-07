import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, CalendarRange, Sliders, History, LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
  },
});

function AppLayout() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/login" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/today" className="font-semibold tracking-tight text-lg">
            Cadence
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavItem to="/today" icon={<LayoutDashboard className="size-4" />} label="Today" />
            <NavItem to="/week" icon={<CalendarRange className="size-4" />} label="Week" />
            <NavItem to="/setup" icon={<Sliders className="size-4" />} label="Setup" />
            <NavItem to="/history" icon={<History className="size-4" />} label="History" />
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden sm:inline">{email}</span>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to as any}
      className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5"
      activeProps={{ className: "px-3 py-1.5 rounded-md bg-accent text-foreground flex items-center gap-1.5" }}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
