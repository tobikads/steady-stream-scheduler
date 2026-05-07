import { AppShell } from "@/components/AppShell";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAGE_LABEL, STAGE_ORDER, StageKind } from "@/lib/schedule";
import { createNextWeek } from "@/lib/week-setup";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
  head: () => ({
    meta: [
      { title: "History — Cadence" },
      { name: "description", content: "Past weeks: planned vs actual per stage." },
    ],
  }),
});

function HistoryPageInner() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<any[]>([]);
  const [stagesByVideo, setStagesByVideo] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data: vids } = await supabase
        .from("videos")
        .select("*")
        .eq("user_id", userData.user.id)
        .order("week_start", { ascending: false });
      setVideos(vids ?? []);
      if (vids && vids.length) {
        const { data: stages } = await supabase
          .from("stages")
          .select("*")
          .in("video_id", vids.map((v) => v.id));
        const grouped: Record<string, any[]> = {};
        for (const s of stages ?? []) {
          (grouped[s.video_id] ??= []).push(s);
        }
        setStagesByVideo(grouped);
      }
      setLoading(false);
    })();
  }, [tick]);

  // Estimation accuracy: average actual/planned per stage kind
  const accuracy: Record<string, { ratios: number[]; avg: number }> = {};
  for (const stages of Object.values(stagesByVideo)) {
    for (const s of stages) {
      const planned = Number(s.planned_blocks);
      const actual = Number(s.actual_blocks);
      if (planned <= 0 || actual <= 0) continue;
      const r = (accuracy[s.kind] ??= { ratios: [], avg: 0 });
      r.ratios.push(actual / planned);
    }
  }
  for (const k of Object.keys(accuracy)) {
    const xs = accuracy[k].ratios;
    accuracy[k].avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  const startNextWeek = async () => {
    setCreating(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      await createNextWeek(userData.user.id);
      toast.success("Next week's video created.");
      setTick((t) => t + 1);
      navigate({ to: "/setup" });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create next week");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            Compare planned vs actual blocks per stage to tune your future estimates.
          </p>
        </div>
        <Button onClick={startNextWeek} disabled={creating}>
          <Plus className="size-4 mr-1" /> {creating ? "Creating…" : "Start next week"}
        </Button>
      </div>

      {Object.keys(accuracy).length > 0 && (
        <Card className="p-5">
          <h3 className="font-medium mb-1">Estimation accuracy</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Ratio of actual ÷ planned blocks across all weeks. 1.0 = spot on. &gt;1 means you under-estimate.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {STAGE_ORDER.filter((k) => accuracy[k]).map((k) => {
              const a = accuracy[k].avg;
              const tone = a > 1.15 ? "text-amber-600" : a < 0.85 ? "text-primary" : "text-foreground";
              return (
                <div key={k}>
                  <div className="text-xs text-muted-foreground">{STAGE_LABEL[k]}</div>
                  <div className={`font-medium tabular-nums ${tone}`}>{a.toFixed(2)}×</div>
                  <div className="text-[10px] text-muted-foreground">
                    {accuracy[k].ratios.length} sample{accuracy[k].ratios.length !== 1 ? "s" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {videos.length === 0 ? (
        <Card className="p-6 text-muted-foreground">No videos yet.</Card>
      ) : (
        videos.map((v) => {
          const stages = (stagesByVideo[v.id] ?? []).sort((a, b) => a.order_index - b.order_index);
          const planned = stages.reduce((s, x) => s + Number(x.planned_blocks), 0);
          const actual = stages.reduce((s, x) => s + Number(x.actual_blocks), 0);
          return (
            <Card key={v.id} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <div>
                  <h3 className="font-medium">{v.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Week of {new Date(v.week_start).toLocaleDateString()} · release {new Date(v.release_date).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant={v.status === "released" ? "default" : "outline"}>{v.status}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
                <Stat label="Planned" value={`${planned.toFixed(1)} blocks`} />
                <Stat label="Actual" value={`${actual.toFixed(1)} blocks`} />
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-normal pb-1">Stage</th>
                    <th className="text-right font-normal pb-1">Planned</th>
                    <th className="text-right font-normal pb-1">Actual</th>
                    <th className="text-right font-normal pb-1">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {stages.map((s) => {
                    const p = Number(s.planned_blocks);
                    const a = Number(s.actual_blocks);
                    const diff = a - p;
                    return (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-1.5">{STAGE_LABEL[s.kind as StageKind]}</td>
                        <td className="py-1.5 text-right tabular-nums">{p.toFixed(1)}</td>
                        <td className="py-1.5 text-right tabular-nums">{a.toFixed(1)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${diff > 0 ? "text-amber-600" : diff < 0 ? "text-primary" : "text-muted-foreground"}`}>
                          {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function HistoryPage() { return <AppShell><HistoryPageInner /></AppShell>; }
