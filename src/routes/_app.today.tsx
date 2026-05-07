import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { applyRebalance } from "@/lib/week-setup";
import {
  STAGE_LABEL,
  StageKind,
  deliveryStatus,
  totalRemainingBlocks,
  upcomingBlockCount,
} from "@/lib/schedule";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Play, Square, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/today")({
  component: TodayPage,
  head: () => ({
    meta: [
      { title: "Today — Cadence" },
      { name: "description", content: "Clock in to your scheduled work blocks." },
    ],
  }),
});

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isSameLocalDay(iso: string, ref: Date) {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function TodayPage() {
  const { data, loading, refresh } = useCurrentWeek();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading || !data) {
    return <div className="p-8 text-muted-foreground">Loading your week…</div>;
  }

  const todayBlocks = data.blocks.filter((b) => isSameLocalDay(b.scheduled_start, now));
  const status = deliveryStatus(
    data.stages.map((s) => ({ ...s, planned_blocks: Number(s.planned_blocks), actual_blocks: Number(s.actual_blocks) })) as any,
    data.blocks as any
  );
  const remaining = totalRemainingBlocks(data.stages.map((s) => ({ ...s, planned_blocks: Number(s.planned_blocks), actual_blocks: Number(s.actual_blocks) })) as any);
  const upcoming = upcomingBlockCount(data.blocks as any);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <StatusBar state={status.state} diff={status.diffBlocks} remaining={remaining} upcoming={upcoming} />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Today · {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        {todayBlocks.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No scheduled blocks today. Enjoy the rest.
          </Card>
        ) : (
          <div className="space-y-3">
            {todayBlocks.map((b) => (
              <BlockCard
                key={b.id}
                block={b}
                stages={data.stages}
                onChanged={refresh}
                videoId={data.videoId}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Stage progress
        </h2>
        <Card className="p-5 space-y-4">
          {data.stages.map((s) => {
            const planned = Number(s.planned_blocks);
            const actual = Number(s.actual_blocks);
            const pct = planned > 0 ? Math.min(100, (actual / planned) * 100) : 0;
            return (
              <div key={s.id} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{STAGE_LABEL[s.kind as StageKind]}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {actual.toFixed(1)} / {planned.toFixed(1)} blocks
                    {s.completed && <CheckCircle2 className="inline ml-1.5 size-3.5 text-primary" />}
                  </span>
                </div>
                <Progress value={pct} />
              </div>
            );
          })}
        </Card>
        <p className="mt-3 text-xs text-muted-foreground">
          Want to adjust estimates? <Link to="/setup" className="underline">Open setup</Link>
        </p>
      </section>
    </div>
  );
}

function StatusBar({
  state,
  diff,
  remaining,
  upcoming,
}: {
  state: "ahead" | "ontrack" | "behind" | "atrisk";
  diff: number;
  remaining: number;
  upcoming: number;
}) {
  const meta = {
    ahead: { label: "Ahead", className: "bg-primary/15 text-primary border-primary/30" },
    ontrack: { label: "On track", className: "bg-secondary text-secondary-foreground border-border" },
    behind: { label: "Behind", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    atrisk: { label: "Saturday at risk", className: "bg-destructive/15 text-destructive border-destructive/30" },
  }[state];

  return (
    <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${meta.className}`}>
          {meta.label}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {remaining.toFixed(1)} blocks of work left · {upcoming} blocks remaining this week
        </p>
      </div>
      <div className="text-right">
        <div className="text-3xl font-semibold tabular-nums">
          {diff >= 0 ? "+" : ""}
          {diff}
        </div>
        <div className="text-xs text-muted-foreground">block buffer</div>
      </div>
    </Card>
  );
}

function BlockCard({
  block,
  stages,
  onChanged,
  videoId,
}: {
  block: any;
  stages: any[];
  onChanged: () => void;
  videoId: string;
}) {
  const stage = stages.find((s) => s.id === block.assigned_stage_id);
  const stageLabel = stage ? STAGE_LABEL[stage.kind as StageKind] : "Unassigned";
  const isInProgress = block.status === "in_progress";
  const isDone = block.status === "done";

  const clockIn = async () => {
    await supabase
      .from("work_blocks")
      .update({ status: "in_progress", clock_in_at: new Date().toISOString() })
      .eq("id", block.id);
    onChanged();
    toast.success("Clocked in. Get to work.");
  };

  const clockOut = async (percentDone: number, fullBlock: boolean) => {
    const start = block.clock_in_at ? new Date(block.clock_in_at) : new Date();
    const end = new Date();
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const portion = fullBlock ? 1 : Math.min(1, minutes / 180); // 3 hours = 1 block

    await supabase
      .from("work_blocks")
      .update({
        status: "done",
        clock_out_at: end.toISOString(),
        actual_minutes: minutes,
      })
      .eq("id", block.id);

    if (stage) {
      const newActual = Number(stage.actual_blocks) + portion;
      const newPct = Math.min(100, percentDone);
      await supabase
        .from("stages")
        .update({
          actual_blocks: newActual,
          percent_complete: newPct,
          completed: newPct >= 100,
        })
        .eq("id", stage.id);
    }

    await applyRebalance(videoId);
    onChanged();
    toast.success("Clocked out. Schedule rebalanced.");
  };

  return (
    <Card className={`p-4 ${isDone ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{block.slot}</Badge>
            <span className="tabular-nums">
              {fmtTime(block.scheduled_start)} – {fmtTime(block.scheduled_end)}
            </span>
          </div>
          <div className="text-base font-medium">{stageLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isInProgress && !isDone && (
            <Button onClick={clockIn} size="sm">
              <Play className="size-4 mr-1" /> Clock in
            </Button>
          )}
          {isInProgress && <ClockOutDialog block={block} onConfirm={clockOut} />}
          {isDone && (
            <span className="text-xs flex items-center gap-1 text-primary">
              <CheckCircle2 className="size-4" /> {block.actual_minutes}m logged
            </span>
          )}
        </div>
      </div>
      {isInProgress && <ActiveTimer startIso={block.clock_in_at} />}
    </Card>
  );
}

function ActiveTimer({ startIso }: { startIso: string }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - new Date(startIso).getTime());
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - new Date(startIso).getTime()), 1000);
    return () => clearInterval(t);
  }, [startIso]);
  const min = Math.floor(elapsed / 60000);
  const sec = Math.floor((elapsed % 60000) / 1000);
  // Break reminder every 60min
  const dueBreak = min > 0 && min % 60 === 0 && sec === 0;
  useEffect(() => {
    if (dueBreak) toast.info("Take your 15-minute break.");
  }, [dueBreak]);
  return (
    <div className="mt-3 text-4xl font-light tabular-nums tracking-tight">
      {String(Math.floor(min / 60)).padStart(2, "0")}:{String(min % 60).padStart(2, "0")}:
      {String(sec).padStart(2, "0")}
    </div>
  );
}

function ClockOutDialog({
  block,
  onConfirm,
}: {
  block: any;
  onConfirm: (percentDone: number, fullBlock: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(50);
  const [fullBlock, setFullBlock] = useState(true);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Square className="size-4 mr-1" /> Clock out
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <Card className="p-6 max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Wrap this block</h3>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                How far along is this stage now? <span className="text-foreground font-medium">{pct}%</span>
              </label>
              <Slider value={[pct]} max={100} step={5} onValueChange={(v) => setPct(v[0])} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fullBlock} onChange={(e) => setFullBlock(e.target.checked)} />
              I worked the full block (count as 1 block)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => { onConfirm(pct, fullBlock); setOpen(false); }}>
                Confirm
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
