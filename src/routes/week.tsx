import { AppShell } from "@/components/AppShell";
import { createFileRoute } from "@tanstack/react-router";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DAY_LABELS, STAGE_LABEL, StageKind } from "@/lib/schedule";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/week")({
  component: WeekPage,
  head: () => ({
    meta: [
      { title: "Week — Cadence" },
      { name: "description", content: "Overall video progress, stage progress, and the week's schedule." },
    ],
  }),
});

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function statusMeta(status: string) {
  switch (status) {
    case "done": return { label: "done", className: "bg-primary/15 text-primary border-primary/30" };
    case "in_progress": return { label: "active", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    case "skipped": return { label: "skipped", className: "bg-muted text-muted-foreground border-border" };
    default: return { label: "upcoming", className: "bg-secondary text-secondary-foreground border-border" };
  }
}

function WeekPageInner() {
  const { data, loading } = useCurrentWeek();
  if (loading || !data) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const stages = data.stages.map((s) => ({
    ...s,
    planned_blocks: Number(s.planned_blocks),
    actual_blocks: Number(s.actual_blocks),
  }));
  const totalPlanned = stages.reduce((sum, s) => sum + s.planned_blocks, 0);
  const totalActual = stages.reduce((sum, s) => sum + Math.min(s.actual_blocks, s.planned_blocks), 0);
  const overallPct = totalPlanned > 0 ? Math.min(100, (totalActual / totalPlanned) * 100) : 0;

  const byDay = new Map<number, any[]>();
  for (const b of data.blocks) {
    const arr = byDay.get(b.day_of_week) ?? [];
    arr.push(b);
    byDay.set(b.day_of_week, arr);
  }
  const todayDow = ((new Date().getDay() + 6) % 7) + 1;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">This week</h1>
        <p className="text-sm text-muted-foreground">
          {data.video.title} · Release:{" "}
          <span className="text-foreground font-medium">
            Saturday {new Date(data.video.release_date).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </p>
      </div>

      {/* Overall progress */}
      <Card className="p-6 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Video progress</h2>
          <span className="text-3xl font-semibold tabular-nums">{Math.round(overallPct)}%</span>
        </div>
        <Progress value={overallPct} className="h-3" />
        <p className="text-sm text-muted-foreground tabular-nums">
          {totalActual.toFixed(1)} of {totalPlanned.toFixed(1)} blocks complete
        </p>
      </Card>

      {/* Stage progress */}
      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Stage progress</h2>
        {stages.map((s) => {
          const pct = s.planned_blocks > 0 ? Math.min(100, (s.actual_blocks / s.planned_blocks) * 100) : 0;
          return (
            <div key={s.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{STAGE_LABEL[s.kind as StageKind]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {s.actual_blocks.toFixed(1)} / {s.planned_blocks.toFixed(1)} blocks
                  {s.completed && <CheckCircle2 className="inline ml-1.5 size-3.5 text-primary" />}
                </span>
              </div>
              <Progress value={pct} />
            </div>
          );
        })}
      </Card>

      {/* Schedule grid (read-only) */}
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">Schedule</h2>
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
                    return (
                      <div
                        key={b.id}
                        className={`rounded-md border border-border p-2.5 text-sm space-y-1 ${
                          isDone || isSkipped ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">{b.slot}</Badge>
                            <span className="text-xs text-muted-foreground tabular-nums">{fmtTime(b.scheduled_start)}</span>
                          </div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                            {meta.label}
                          </span>
                        </div>
                        <div className="font-medium">
                          {stage ? STAGE_LABEL[stage.kind as StageKind] : <span className="text-muted-foreground italic">unassigned</span>}
                        </div>
                        {isDone && b.actual_minutes > 0 && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="size-3 text-primary" /> {b.actual_minutes}m logged
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekPage() { return <AppShell><WeekPageInner /></AppShell>; }
