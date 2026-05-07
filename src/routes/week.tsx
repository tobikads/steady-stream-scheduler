import { AppShell } from "@/components/AppShell";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DAY_LABELS, STAGE_LABEL, StageKind } from "@/lib/schedule";
import { supabase } from "@/integrations/supabase/client";
import { applyRebalance } from "@/lib/week-setup";
import { toast } from "sonner";
import { CheckCircle2, Play, SkipForward, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/week")({
  component: WeekPage,
  head: () => ({
    meta: [
      { title: "Week — Cadence" },
      { name: "description", content: "Your full Mon–Sat block schedule for this video." },
    ],
  }),
});

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function statusMeta(status: string) {
  switch (status) {
    case "done":
      return { label: "done", className: "bg-primary/15 text-primary border-primary/30" };
    case "in_progress":
      return { label: "active", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    case "skipped":
      return { label: "skipped", className: "bg-muted text-muted-foreground border-border" };
    default:
      return { label: "upcoming", className: "bg-secondary text-secondary-foreground border-border" };
  }
}

function WeekPageInner() {
  const { data, loading, refresh } = useCurrentWeek();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading || !data) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const updateBlock = async (
    blockId: string,
    patch: any,
    successMsg: string,
    rebalanceAfter = true
  ) => {
    setBusyId(blockId);
    const { error } = await supabase.from("work_blocks").update(patch).eq("id", blockId);
    if (error) {
      setBusyId(null);
      toast.error(error.message);
      return;
    }
    if (rebalanceAfter) {
      const r = await applyRebalance(data.videoId);
      if (!r.ok) {
        setBusyId(null);
        toast.error(`Rebalance failed: ${r.error}`);
        return;
      }
    }
    setBusyId(null);
    toast.success(successMsg);
    refresh();
  };

  const byDay = new Map<number, any[]>();
  for (const b of data.blocks) {
    const arr = byDay.get(b.day_of_week) ?? [];
    arr.push(b);
    byDay.set(b.day_of_week, arr);
  }

  const todayDow = ((new Date().getDay() + 6) % 7) + 1; // 1=Mon..7=Sun

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">This week</h1>
      <p className="text-sm text-muted-foreground mb-6">
        {data.video.title} · Release:{" "}
        <span className="text-foreground font-medium">
          Saturday {new Date(data.video.release_date).toLocaleDateString([], { month: "short", day: "numeric" })}
        </span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DAY_LABELS.map((label, i) => {
          const dow = i + 1;
          const blocks = (byDay.get(dow) ?? []).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
          const isTodayCol = dow === todayDow;
          const doneCount = blocks.filter((b) => b.status === "done").length;
          return (
            <Card key={dow} className={`p-4 ${isTodayCol ? "border-primary/50 ring-1 ring-primary/20" : ""}`}>
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-semibold flex items-center gap-2">
                  {label}
                  {isTodayCol && <Badge variant="default" className="text-[10px]">Today</Badge>}
                </h3>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {doneCount}/{blocks.length} done
                </span>
              </div>
              <div className="space-y-2">
                {blocks.map((b) => {
                  const stage = data.stages.find((s) => s.id === b.assigned_stage_id);
                  const meta = statusMeta(b.status);
                  const isDone = b.status === "done";
                  const isSkipped = b.status === "skipped";
                  const isActive = b.status === "in_progress";
                  const blockIsToday = isToday(b.scheduled_start);
                  const isBusy = busyId === b.id;
                  return (
                    <div
                      key={b.id}
                      className={`rounded-md border border-border p-2.5 text-sm space-y-2 ${
                        isDone || isSkipped ? "opacity-60" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">{b.slot}</Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {fmtTime(b.scheduled_start)}
                          </span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="font-medium">
                        {stage ? (
                          STAGE_LABEL[stage.kind as StageKind]
                        ) : (
                          <span className="text-muted-foreground italic">unassigned</span>
                        )}
                      </div>
                      {isDone && b.actual_minutes > 0 && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <CheckCircle2 className="size-3 text-primary" /> {b.actual_minutes}m logged
                        </div>
                      )}
                      <div className="flex items-center gap-1 flex-wrap">
                        {!isDone && !isActive && !isSkipped && blockIsToday && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs"
                            disabled={isBusy}
                            onClick={() =>
                              updateBlock(
                                b.id,
                                { status: "in_progress", clock_in_at: new Date().toISOString() },
                                "Clocked in.",
                                false
                              )
                            }
                          >
                            <Play className="size-3 mr-1" /> Start
                          </Button>
                        )}
                        {!isDone && !isSkipped && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={isBusy}
                            onClick={() => updateBlock(b.id, { status: "skipped" }, "Skipped — rebalanced.")}
                          >
                            <SkipForward className="size-3 mr-1" /> Skip
                          </Button>
                        )}
                        {isSkipped && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={isBusy}
                            onClick={() => updateBlock(b.id, { status: "upcoming" }, "Restored — rebalanced.")}
                          >
                            <RotateCcw className="size-3 mr-1" /> Restore
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function WeekPage() { return <AppShell><WeekPageInner /></AppShell>; }
