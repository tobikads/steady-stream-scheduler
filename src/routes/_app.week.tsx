import { createFileRoute } from "@tanstack/react-router";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DAY_LABELS, STAGE_LABEL, StageKind } from "@/lib/schedule";

export const Route = createFileRoute("/_app/week")({
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

function WeekPage() {
  const { data, loading } = useCurrentWeek();
  if (loading || !data) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const byDay = new Map<number, any[]>();
  for (const b of data.blocks) {
    const arr = byDay.get(b.day_of_week) ?? [];
    arr.push(b);
    byDay.set(b.day_of_week, arr);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight mb-1">This week</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Release: <span className="text-foreground font-medium">Saturday {new Date(data.video.release_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {DAY_LABELS.map((label, i) => {
          const dow = i + 1;
          const blocks = (byDay.get(dow) ?? []).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
          return (
            <Card key={dow} className="p-4">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-semibold">{label}</h3>
                <span className="text-xs text-muted-foreground">{blocks.length} blocks</span>
              </div>
              <div className="space-y-2">
                {blocks.map((b) => {
                  const stage = data.stages.find((s) => s.id === b.assigned_stage_id);
                  const isDone = b.status === "done";
                  return (
                    <div
                      key={b.id}
                      className={`rounded-md border border-border p-2.5 text-sm ${isDone ? "opacity-50 line-through decoration-muted-foreground/40" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px]">{b.slot}</Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtTime(b.scheduled_start)}
                        </span>
                      </div>
                      <div className="font-medium">
                        {stage ? STAGE_LABEL[stage.kind as StageKind] : <span className="text-muted-foreground italic">unassigned</span>}
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
