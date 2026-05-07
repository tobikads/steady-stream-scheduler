import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Cadence — Ship one video every Saturday" },
      {
        name: "description",
        content:
          "A 16-block weekly planner that rebalances your video production toward Saturday delivery.",
      },
    ],
  }),
});

function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/today" });
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-semibold tracking-tight text-lg">Cadence</span>
          <Link to="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center space-y-8">
          <div className="inline-block px-3 py-1 rounded-full border border-border text-xs uppercase tracking-wider text-muted-foreground">
            Ship one video every Saturday
          </div>
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
            Stop guessing.
            <br />
            <span className="text-primary">Start delivering.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            16 scheduled work blocks per week. Clock in, log your progress, and
            Cadence rebalances your week toward Saturday — automatically.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link to="/login">
              <Button size="lg">Get started</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-12 text-left">
            {[
              { t: "Fixed capacity", d: "Mon–Sat AM/PM blocks plus Tue/Thu/Fri/Sat evenings." },
              { t: "Live rebalancing", d: "Behind or ahead, your week reshuffles after every clock-out." },
              { t: "Saturday delivery", d: "A status bar tells you if your release date is at risk." },
            ].map((f) => (
              <div key={f.t} className="rounded-lg border border-border p-4">
                <div className="font-medium">{f.t}</div>
                <div className="text-sm text-muted-foreground mt-1">{f.d}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
