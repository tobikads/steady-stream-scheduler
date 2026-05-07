import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CalendarRange, History, LayoutDashboard, LogIn, LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";

type NavPath = "/today" | "/week" | "/history";

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-background" />;

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmail(null);
    navigate({ to: "/today" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/today" className="font-semibold tracking-tight text-lg">
            YT Video Scheduler
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <NavItem to="/today" icon={<LayoutDashboard className="size-4" />} label="Today" />
            <NavItem to="/week" icon={<CalendarRange className="size-4" />} label="Week" />
            <NavItem to="/history" icon={<History className="size-4" />} label="History" />
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground hidden md:inline">
              {email ?? "Local mode"}
            </span>
            {email ? (
              <Button variant="outline" size="sm" onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">
                  <LogIn className="size-4" />
                  Sign in
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}

function NavItem({ to, icon, label }: { to: NavPath; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent flex items-center gap-1.5"
      activeProps={{
        className: "px-3 py-1.5 rounded-md bg-accent text-foreground flex items-center gap-1.5",
      }}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
