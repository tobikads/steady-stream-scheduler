import { AppShell } from "@/components/AppShell";
import { CloudSyncNotice } from "@/components/CloudSyncNotice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_BLOCK_MINUTES,
  buildCatchUpPlan,
  dayLabel,
  formatCatchUpMinutes,
  type CatchUpAction,
} from "@/lib/catch-up";
import type { WorkBlockRow } from "@/lib/db-types";
import { updateLocalWeek } from "@/lib/local-week";
import { STAGE_LABEL } from "@/lib/schedule";
import { applyRebalance } from "@/lib/week-setup";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarPlus, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/catch-up")({
  component: CatchUpPage,
  head: () => ({
    meta: [
      { title: "Catch Up - YT Video Scheduler" },
      {
        name: "description",
        content: "Recover missed video work and protect Saturday upload timing.",
      },
    ],
  }),
});

function fmtTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function portionFor(minutes: number) {
  return Math.max(0.01, Math.min(1, Math.round((minutes / DEFAULT_BLOCK_MINUTES) * 100) / 100));
}

function newLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function actionTitle(action: CatchUpAction) {
  if (action.type === "extra_block") {
    return `${dayLabel(action.day_of_week)} catch-up block`;
  }
  return `${dayLabel(action.day_of_week)} ${action.slot} shorter break`;
}

function actionDetail(action: CatchUpAction) {
  if (action.type === "extra_block") {
    return `${fmtTime(action.scheduled_start)}-${fmtTime(action.scheduled_end)} for ${action.stageLabel}`;
  }
  return `${action.stageLabel}: ${action.fromBreakMinutes}m rest becomes ${action.toBreakMinutes}m`;
}

function applyLocalActions(videoId: string, actions: CatchUpAction[]) {
  const now = new Date().toISOString();
  updateLocalWeek((bundle) => {
    const restActions = new Map(
      actions
        .filter(
          (action): action is Extract<CatchUpAction, { type: "short_break" }> =>
            action.type === "short_break",
        )
        .map((action) => [action.blockId, action]),
    );
    const updatedBlocks = bundle.blocks.map((block) => {
      const rest = restActions.get(block.id);
      if (!rest) return block;
      return {
        ...block,
        planned_break_minutes: rest.toBreakMinutes,
        updated_at: now,
      };
    });
    const extraBlocks: WorkBlockRow[] = actions
      .filter(
        (action): action is Extract<CatchUpAction, { type: "extra_block" }> =>
          action.type === "extra_block",
      )
      .map((action) => ({
        id: newLocalId("local-catch-up"),
        video_id: videoId,
        user_id: "local",
        day_of_week: action.day_of_week,
        slot: action.slot,
        scheduled_start: action.scheduled_start,
        scheduled_end: action.scheduled_end,
        assigned_stage_id: action.stageId,
        assigned_portion: portionFor(action.minutes),
        clock_in_at: null,
        clock_out_at: null,
        actual_minutes: 0,
        status: "upcoming",
        notes: null,
        is_catch_up: true,
        planned_break_minutes: 10,
        pause_count: 0,
        pause_minutes: 0,
        task_snapshot: null,
        created_at: now,
        updated_at: now,
      }));
    return {
      ...bundle,
      blocks: [...updatedBlocks, ...extraBlocks].sort((a, b) =>
        a.scheduled_start.localeCompare(b.scheduled_start),
      ),
      video: { ...bundle.video, updated_at: now },
    };
  });
}

async function applyCloudActions(videoId: string, userId: string, actions: CatchUpAction[]) {
  const extraBlocks = actions.filter(
    (action): action is Extract<CatchUpAction, { type: "extra_block" }> =>
      action.type === "extra_block",
  );
  const restCuts = actions.filter(
    (action): action is Extract<CatchUpAction, { type: "short_break" }> =>
      action.type === "short_break",
  );

  if (extraBlocks.length > 0) {
    const { error } = await supabase.from("work_blocks").insert(
      extraBlocks.map((action) => ({
        video_id: videoId,
        user_id: userId,
        day_of_week: action.day_of_week,
        slot: action.slot,
        scheduled_start: action.scheduled_start,
        scheduled_end: action.scheduled_end,
        assigned_stage_id: action.stageId,
        assigned_portion: portionFor(action.minutes),
        is_catch_up: true,
        planned_break_minutes: 10,
      })),
    );
    if (error) throw error;
  }

  const updates = await Promise.all(
    restCuts.map((action) =>
      supabase
        .from("work_blocks")
        .update({ planned_break_minutes: action.toBreakMinutes })
        .eq("id", action.blockId),
    ),
  );
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) throw updateError;

  const rebalance = await applyRebalance(videoId);
  if (!rebalance.ok) throw new Error(rebalance.error ?? "Rebalance failed");
}

function CatchUpPageInner() {
  const { data, loading, error, mode, refresh } = useCurrentWeek();
  const [applying, setApplying] = useState(false);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">Catch Up did not load</h1>
          <p className="text-sm text-muted-foreground">{error ?? "No current week found."}</p>
          <Button onClick={refresh}>Try again</Button>
        </Card>
      </div>
    );
  }

  const plan = buildCatchUpPlan(data.video, data.stages, data.blocks);
  const canApply = plan.actions.length > 0 && plan.state !== "on_track";
  const extraActions = plan.actions.filter(
    (action): action is Extract<CatchUpAction, { type: "extra_block" }> =>
      action.type === "extra_block",
  );
  const restActions = plan.actions.filter(
    (action): action is Extract<CatchUpAction, { type: "short_break" }> =>
      action.type === "short_break",
  );
  const restRecoveryMinutes = restActions.reduce((sum, action) => sum + action.minutes, 0);
  const status =
    plan.state === "on_track"
      ? { label: "On track", className: "bg-primary/15 text-primary border-primary/30" }
      : plan.state === "recoverable"
        ? { label: "Recoverable", className: "bg-sky-500/15 text-sky-600 border-sky-500/30" }
        : {
            label: "Not possible",
            className: "bg-destructive/15 text-destructive border-destructive/30",
          };

  const applyPlan = async () => {
    if (!canApply) return;
    setApplying(true);
    try {
      if (mode === "local") {
        applyLocalActions(data.videoId, plan.actions);
      } else {
        await applyCloudActions(data.videoId, data.video.user_id, plan.actions);
      }
      toast.success("Catch-up plan applied.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Catch-up plan failed.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Catch Up</h1>
          <p className="text-sm text-muted-foreground">
            Recovery plan for {data.video.title} before Saturday.
          </p>
        </div>
        <Badge variant="outline" className={status.className}>
          {status.label}
        </Badge>
      </div>

      {mode === "local" && <CloudSyncNotice onRetry={refresh} showSignIn />}

      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Video completion
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Catch Up uses the same progress math as Today and Week.
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-semibold tabular-nums">
              {Math.round(plan.overallPct)}%
            </span>
            <div className="text-xs text-muted-foreground">complete</div>
          </div>
        </div>
        <Progress value={plan.overallPct} className="h-3" />
        <div className="grid gap-3 sm:grid-cols-5 text-sm">
          <Stat label="Work left" value={formatCatchUpMinutes(plan.workLeftMinutes)} />
          <Stat label="Scheduled ahead" value={formatCatchUpMinutes(plan.futureScheduledMinutes)} />
          <Stat label="Missed or short" value={formatCatchUpMinutes(plan.missedOrShortMinutes)} />
          <Stat label="Real gap" value={formatCatchUpMinutes(plan.deficitMinutes)} />
          <Stat label="Recovery target" value={formatCatchUpMinutes(plan.targetRecoveryMinutes)} />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {plan.state === "impossible" ? (
              <AlertTriangle className="size-5 text-destructive mt-0.5" />
            ) : plan.state === "on_track" ? (
              <CheckCircle2 className="size-5 text-primary mt-0.5" />
            ) : (
              <Sparkles className="size-5 text-sky-600 mt-0.5" />
            )}
            <div>
              <h2 className="font-semibold">Recovery plan</h2>
              <p className="text-sm text-muted-foreground">
                {plan.state === "on_track"
                  ? "You do not need extra catch-up time right now."
                  : plan.state === "recoverable"
                    ? `This plan can recover ${formatCatchUpMinutes(plan.recoveryMinutes)}.`
                    : `Even after recovering ${formatCatchUpMinutes(plan.recoveryMinutes)}, you are still short by ${formatCatchUpMinutes(plan.remainingGapMinutes)}.`}
              </p>
            </div>
          </div>
          <Button onClick={applyPlan} disabled={!canApply || applying}>
            <CalendarPlus className="size-4 mr-2" />
            {applying ? "Applying..." : "Apply plan"}
          </Button>
        </div>

        {plan.state === "impossible" && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            It is not possible to finish this video before Saturday with the remaining schedule.
          </div>
        )}

        {plan.actions.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No recovery actions needed.
          </div>
        ) : (
          <div className="space-y-2">
            {extraActions.map((action) => (
              <div key={action.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{actionTitle(action)}</div>
                  <Badge variant="outline" className="text-[10px]">
                    +{formatCatchUpMinutes(action.minutes)}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {actionDetail(action)}
                </div>
              </div>
            ))}
            {restActions.length > 0 && (
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">Shorten upcoming breaks</div>
                  <Badge variant="outline" className="text-[10px]">
                    +{formatCatchUpMinutes(restRecoveryMinutes)}
                  </Badge>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {restActions.length} future breaks move from 15m to 10m.
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold">Stage pressure</h2>
        <div className="space-y-2">
          {[...data.stages]
            .sort((a, b) => a.order_index - b.order_index)
            .map((stage) => {
              const planned = Number(stage.planned_blocks);
              const actual = Number(stage.actual_blocks);
              const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
              return (
                <div key={stage.id} className="space-y-1.5">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium">{STAGE_LABEL[stage.kind]}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {actual.toFixed(1)} / {planned.toFixed(1)} blocks
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
              );
            })}
        </div>
      </Card>
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

function CatchUpPage() {
  return (
    <AppShell>
      <CatchUpPageInner />
    </AppShell>
  );
}
