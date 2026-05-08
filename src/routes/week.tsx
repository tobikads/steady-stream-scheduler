import { AppShell } from "@/components/AppShell";
import { CloudSyncNotice } from "@/components/CloudSyncNotice";
import { createFileRoute } from "@tanstack/react-router";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DAY_LABELS,
  STAGE_LABEL,
  deliveryStatus,
  totalRemainingBlocks,
  upcomingBlockCount,
} from "@/lib/schedule";
import { blockDisplayTitle, recoveryStageDetail } from "@/lib/catch-up";
import { CheckCircle2 } from "lucide-react";
import type { WorkBlockRow, WorkBlockStatus } from "@/lib/db-types";

export const Route = createFileRoute("/week")({
  component: WeekPage,
  head: () => ({
    meta: [
      { title: "Week — YT Video Scheduler" },
      {
        name: "description",
        content: "Overall video progress, stage progress, and the week's schedule.",
      },
    ],
  }),
});

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function effectiveBlockStatus(block: WorkBlockRow, now: Date): WorkBlockStatus {
  if (block.status === "upcoming" && new Date(block.scheduled_end).getTime() < now.getTime()) {
    return "missed";
  }
  return block.status;
}

function statusMeta(status: string) {
  switch (status) {
    case "done":
      return { label: "done", className: "bg-primary/15 text-primary border-primary/30" };
    case "partial":
      return { label: "partial", className: "bg-sky-500/15 text-sky-700 border-sky-500/30" };
    case "missed":
      return {
        label: "missed",
        className: "bg-destructive/15 text-destructive border-destructive/30",
      };
    case "in_progress":
      return { label: "active", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    case "skipped":
      return { label: "skipped", className: "bg-muted text-muted-foreground border-border" };
    default:
      return {
        label: "upcoming",
        className: "bg-secondary text-secondary-foreground border-border",
      };
  }
}

function deliveryMeta(state: "ahead" | "ontrack" | "behind" | "atrisk") {
  return {
    ahead: { label: "Ahead", className: "bg-primary/15 text-primary border-primary/30" },
    ontrack: {
      label: "On track",
      className: "bg-secondary text-secondary-foreground border-border",
    },
    behind: { label: "Behind", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    atrisk: {
      label: "At risk",
      className: "bg-destructive/15 text-destructive border-destructive/30",
    },
  }[state];
}

function daySummary(blocks: WorkBlockRow[], now: Date) {
  const counts = blocks.reduce(
    (acc, block) => {
      const status = effectiveBlockStatus(block, now);
      if (status === "done") acc.done += 1;
      if (status === "partial") acc.partial += 1;
      if (status === "missed" || status === "skipped") acc.missed += 1;
      return acc;
    },
    { done: 0, partial: 0, missed: 0 },
  );
  const parts = [`${counts.done} done`];
  if (counts.partial > 0) parts.push(`${counts.partial} partial`);
  if (counts.missed > 0) parts.push(`${counts.missed} missed`);
  return parts.join(" - ");
}

function WeekPageInner() {
  const { data, loading, error, mode, cloudError, refresh } = useCurrentWeek();
  if (loading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">Week did not load</h1>
          <p className="text-sm text-muted-foreground">{error ?? "Video data was unavailable."}</p>
          <button
            type="button"
            onClick={refresh}
            className="text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </Card>
      </div>
    );
  }

  const stages = data.stages.map((s) => ({
    ...s,
    planned_blocks: Number(s.planned_blocks),
    actual_blocks: Number(s.actual_blocks),
  }));
  const totalPlanned = stages.reduce((sum, s) => sum + s.planned_blocks, 0);
  const totalActual = stages.reduce(
    (sum, s) => sum + Math.min(s.actual_blocks, s.planned_blocks),
    0,
  );
  const overallPct = totalPlanned > 0 ? Math.min(100, (totalActual / totalPlanned) * 100) : 0;
  const now = new Date();
  const scheduleBlocks = data.blocks.map((block) => ({
    ...block,
    status: effectiveBlockStatus(block, now),
  }));
  const status = deliveryStatus(stages, scheduleBlocks);
  const statusDisplay = deliveryMeta(status.state);
  const remaining = totalRemainingBlocks(stages);
  const upcoming = upcomingBlockCount(scheduleBlocks);

  const byDay = new Map<number, WorkBlockRow[]>();
  for (const b of scheduleBlocks) {
    const arr = byDay.get(b.day_of_week) ?? [];
    arr.push(b);
    byDay.set(b.day_of_week, arr);
  }
  const todayDow = ((now.getDay() + 6) % 7) + 1;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight mb-1">This week</h1>
        <p className="text-sm text-muted-foreground">
          {data.video.title} · Release:{" "}
          <span className="text-foreground font-medium">
            Saturday{" "}
            {new Date(data.video.release_date).toLocaleDateString([], {
              month: "short",
              day: "numeric",
            })}
          </span>
        </p>
      </div>

      {(mode === "local" || cloudError) && (
        <CloudSyncNotice message={cloudError} onRetry={refresh} showSignIn={!cloudError} />
      )}

      {/* Overall progress */}
      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Video progress
              </h2>
              <span
                className={`text-[10px] px-2 py-0.5 rounded border font-medium ${statusDisplay.className}`}
              >
                {statusDisplay.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              {totalActual.toFixed(1)} of {totalPlanned.toFixed(1)} blocks complete
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-semibold tabular-nums">{Math.round(overallPct)}%</span>
            <div className="text-xs text-muted-foreground">complete</div>
          </div>
        </div>
        <Progress value={overallPct} className="h-3" />
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <Stat label="Work left" value={`${remaining.toFixed(1)} blocks`} />
          <Stat label="Blocks left" value={`${upcoming} scheduled`} />
        </div>
      </Card>

      {/* Stage progress */}
      <Card className="p-6 space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Stage progress
        </h2>
        {stages.map((s) => {
          const pct =
            s.planned_blocks > 0 ? Math.min(100, (s.actual_blocks / s.planned_blocks) * 100) : 0;
          return (
            <div key={s.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{STAGE_LABEL[s.kind]}</span>
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
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Schedule
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {DAY_LABELS.map((label, i) => {
            const dow = i + 1;
            const blocks = (byDay.get(dow) ?? []).sort((a, b) =>
              a.scheduled_start.localeCompare(b.scheduled_start),
            );
            const isTodayCol = dow === todayDow;
            return (
              <Card
                key={dow}
                className={`p-4 ${isTodayCol ? "border-primary/50 ring-1 ring-primary/20" : ""}`}
              >
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    {label}
                    {isTodayCol && (
                      <Badge variant="default" className="text-[10px]">
                        Today
                      </Badge>
                    )}
                  </h3>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {daySummary(blocks, now)}
                  </span>
                </div>
                <div className="space-y-2">
                  {blocks.map((b) => {
                    const stage = data.stages.find((s) => s.id === b.assigned_stage_id);
                    const title = blockDisplayTitle(b, stage);
                    const recoveryDetail = recoveryStageDetail(b, stage);
                    const displayStatus = effectiveBlockStatus(b, now);
                    const meta = statusMeta(displayStatus);
                    const isDone = displayStatus === "done";
                    const isPartial = displayStatus === "partial";
                    const isMissed = displayStatus === "missed" || displayStatus === "skipped";
                    return (
                      <div
                        key={b.id}
                        className={`rounded-md border border-border p-2.5 text-sm space-y-1 ${
                          isMissed ? "opacity-60" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px]">
                              {b.slot}
                            </Badge>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {fmtTime(b.scheduled_start)}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <div className="font-medium">
                          {title !== "Unassigned" ? (
                            title
                          ) : (
                            <span className="text-muted-foreground italic">unassigned</span>
                          )}
                        </div>
                        {recoveryDetail && (
                          <div className="text-xs text-muted-foreground">{recoveryDetail}</div>
                        )}
                        {isDone && b.actual_minutes > 0 && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="size-3 text-primary" /> {b.actual_minutes}m
                            logged
                          </div>
                        )}
                        {isPartial && b.actual_minutes > 0 && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="size-3 text-sky-600" /> {b.actual_minutes}m
                            partial
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

function WeekPage() {
  return (
    <AppShell>
      <WeekPageInner />
    </AppShell>
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
