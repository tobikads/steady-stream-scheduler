import { AppShell } from "@/components/AppShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Play, Square, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/today")({
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

function fmtCountdown(ms: number) {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function TodayPageInner() {
  const { data, loading, refresh } = useCurrentWeek();
  const [now, setNow] = useState(new Date());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (data) setTitleDraft(data.video.title);
  }, [data?.videoId]);

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

  const nextBlock = data.blocks
    .filter((b) => b.status === "upcoming" && new Date(b.scheduled_start).getTime() > now.getTime())
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0];

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleDraft.trim() === data.video.title) return;
    const { error } = await supabase
      .from("videos")
      .update({ title: titleDraft.trim() || "Untitled video" })
      .eq("id", data.videoId);
    if (error) {
      toast.error(`Couldn't save title: ${error.message}`);
      return;
    }
    toast.success("Title updated.");
    refresh();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center gap-2">
        {editingTitle ? (
          <Input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") {
                setTitleDraft(data.video.title);
                setEditingTitle(false);
              }
            }}
            className="text-2xl font-semibold h-11"
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="group flex items-center gap-2 text-2xl font-semibold tracking-tight hover:text-primary transition-colors"
          >
            {data.video.title}
            <Pencil className="size-4 opacity-0 group-hover:opacity-60" />
          </button>
        )}
      </div>

      <StatusBar state={status.state} diff={status.diffBlocks} remaining={remaining} upcoming={upcoming} />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Today · {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        {todayBlocks.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            No scheduled blocks today.
            {nextBlock && (
              <div className="mt-2 text-sm">
                Next block: <span className="text-foreground font-medium">
                  {new Date(nextBlock.scheduled_start).toLocaleDateString([], { weekday: "short" })} at {fmtTime(nextBlock.scheduled_start)}
                </span>{" "}
                (in {fmtCountdown(new Date(nextBlock.scheduled_start).getTime() - now.getTime())})
              </div>
            )}
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
                now={now}
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
  now,
}: {
  block: any;
  stages: any[];
  onChanged: () => void;
  videoId: string;
  now: Date;
}) {
  const stage = stages.find((s) => s.id === block.assigned_stage_id);
  const stageLabel = stage ? STAGE_LABEL[stage.kind as StageKind] : "Unassigned";
  const isInProgress = block.status === "in_progress";
  const isDone = block.status === "done";
  const isSkipped = block.status === "skipped";
  const [wrapping, setWrapping] = useState(false);
  const [pct, setPct] = useState(stage ? Math.min(100, Math.round((Number(stage.actual_blocks) / Math.max(0.01, Number(stage.planned_blocks))) * 100)) : 50);
  const [fullBlock, setFullBlock] = useState(true);
  const [busy, setBusy] = useState(false);

  const clockIn = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("work_blocks")
      .update({ status: "in_progress", clock_in_at: new Date().toISOString() })
      .eq("id", block.id);
    setBusy(false);
    if (error) {
      toast.error(`Clock-in failed: ${error.message}`);
      return;
    }
    toast.success("Clocked in. Get to work.");
    onChanged();
  };

  const skip = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("work_blocks")
      .update({ status: "skipped" })
      .eq("id", block.id);
    if (!error) {
      const r = await applyRebalance(videoId);
      if (!r.ok) toast.error(`Rebalance failed: ${r.error}`);
    }
    setBusy(false);
    if (error) {
      toast.error(`Skip failed: ${error.message}`);
      return;
    }
    toast.success("Block skipped. Schedule rebalanced.");
    onChanged();
  };

  const confirmWrap = async () => {
    setBusy(true);
    const start = block.clock_in_at ? new Date(block.clock_in_at) : new Date();
    const end = new Date();
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const portion = fullBlock ? 1 : Math.min(1, minutes / 180);

    const { error: bErr } = await supabase
      .from("work_blocks")
      .update({
        status: "done",
        clock_out_at: end.toISOString(),
        actual_minutes: minutes,
      })
      .eq("id", block.id);
    if (bErr) {
      setBusy(false);
      toast.error(`Clock-out failed: ${bErr.message}`);
      return;
    }

    if (stage) {
      const newActual = Number(stage.actual_blocks) + portion;
      const { error: sErr } = await supabase
        .from("stages")
        .update({
          actual_blocks: newActual,
          percent_complete: pct,
          completed: pct >= 100,
        })
        .eq("id", stage.id);
      if (sErr) {
        setBusy(false);
        toast.error(`Stage update failed: ${sErr.message}`);
        return;
      }
    }

    const r = await applyRebalance(videoId);
    setBusy(false);
    if (!r.ok) {
      toast.error(`Rebalance failed: ${r.error}`);
    } else {
      toast.success("Clocked out. Schedule rebalanced.");
    }
    setWrapping(false);
    onChanged();
  };

  return (
    <Card className={`p-4 ${isDone || isSkipped ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{block.slot}</Badge>
            <span className="tabular-nums">
              {fmtTime(block.scheduled_start)} – {fmtTime(block.scheduled_end)}
            </span>
            {isSkipped && <Badge variant="secondary">skipped</Badge>}
          </div>
          <div className="text-base font-medium">{stageLabel}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isInProgress && !isDone && !isSkipped && (
            <>
              <Button onClick={clockIn} size="sm" disabled={busy}>
                <Play className="size-4 mr-1" /> Clock in
              </Button>
              <Button onClick={skip} size="sm" variant="ghost" disabled={busy}>
                Skip
              </Button>
            </>
          )}
          {isInProgress && !wrapping && (
            <Button size="sm" variant="secondary" onClick={() => setWrapping(true)}>
              <Square className="size-4 mr-1" /> Clock out
            </Button>
          )}
          {isDone && (
            <span className="text-xs flex items-center gap-1 text-primary">
              <CheckCircle2 className="size-4" /> {block.actual_minutes}m logged
            </span>
          )}
        </div>
      </div>
      {isInProgress && <ActiveTimer startIso={block.clock_in_at} />}
      {wrapping && (
        <div className="mt-4 pt-4 border-t border-border space-y-3">
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              {stageLabel} progress now: <span className="text-foreground font-medium">{pct}%</span>
            </label>
            <Slider value={[pct]} max={100} step={5} onValueChange={(v) => setPct(v[0])} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fullBlock} onChange={(e) => setFullBlock(e.target.checked)} />
            I worked the full block (count as 1 block)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setWrapping(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={confirmWrap} disabled={busy}>
              {busy ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </div>
      )}
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

function TodayPage() { return <AppShell><TodayPageInner /></AppShell>; }
