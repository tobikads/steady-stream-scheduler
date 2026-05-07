import { AppShell } from "@/components/AppShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Play, Square, CheckCircle2, Pencil, Coffee, SkipForward } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/today")({
  component: TodayPage,
  head: () => ({
    meta: [
      { title: "Today — Cadence" },
      { name: "description", content: "Clock in and run your work timer." },
    ],
  }),
});

const WORK_MS = 60 * 60 * 1000;
const BREAK_MS = 15 * 60 * 1000;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function isSameLocalDay(iso: string, ref: Date) {
  const d = new Date(iso);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
}
function fmtCountdown(ms: number) {
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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
  }, [data?.videoId, data?.video?.title]);

  if (loading || !data) return <div className="p-8 text-muted-foreground">Loading your week…</div>;

  const stagesNum = data.stages.map((s) => ({
    ...s,
    planned_blocks: Number(s.planned_blocks),
    actual_blocks: Number(s.actual_blocks),
  })) as any;

  const todayBlocks = data.blocks
    .filter((b) => isSameLocalDay(b.scheduled_start, now))
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  const status = deliveryStatus(stagesNum, data.blocks as any);
  const remaining = totalRemainingBlocks(stagesNum);
  const upcoming = upcomingBlockCount(data.blocks as any);

  const activeBlock = data.blocks.find((b) => b.status === "in_progress");
  const nextBlock =
    activeBlock ??
    todayBlocks.find((b) => b.status === "upcoming") ??
    data.blocks
      .filter((b) => b.status === "upcoming" && new Date(b.scheduled_start).getTime() > now.getTime())
      .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0];

  const saveTitle = async () => {
    const next = titleDraft.trim() || "Untitled video";
    setEditingTitle(false);
    if (next === data.video.title) return;
    const { error } = await supabase.from("videos").update({ title: next }).eq("id", data.videoId);
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
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
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

      <TimerPanel
        block={nextBlock ?? null}
        stages={data.stages}
        videoId={data.videoId}
        now={now}
        onChanged={refresh}
      />

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Today · {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        {todayBlocks.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">No scheduled blocks today.</Card>
        ) : (
          <Card className="p-2 divide-y divide-border">
            {todayBlocks.map((b) => {
              const stage = data.stages.find((s) => s.id === b.assigned_stage_id);
              const meta = badgeMeta(b.status);
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{b.slot}</Badge>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtTime(b.scheduled_start)} – {fmtTime(b.scheduled_end)}
                    </span>
                    <span className="font-medium">
                      {stage ? STAGE_LABEL[stage.kind as StageKind] : "—"}
                    </span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </Card>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          See <Link to="/week" className="underline">the week view</Link> for stage progress and the full schedule.
        </p>
      </section>
    </div>
  );
}

function badgeMeta(status: string) {
  switch (status) {
    case "done": return { label: "done", className: "bg-primary/15 text-primary border-primary/30" };
    case "in_progress": return { label: "active", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
    case "skipped": return { label: "skipped", className: "bg-muted text-muted-foreground border-border" };
    default: return { label: "upcoming", className: "bg-secondary text-secondary-foreground border-border" };
  }
}

function StatusBar({
  state, diff, remaining, upcoming,
}: { state: "ahead" | "ontrack" | "behind" | "atrisk"; diff: number; remaining: number; upcoming: number }) {
  const meta = {
    ahead: { label: "Ahead", className: "bg-primary/15 text-primary border-primary/30" },
    ontrack: { label: "On track", className: "bg-secondary text-secondary-foreground border-border" },
    behind: { label: "Behind", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
    atrisk: { label: "Saturday at risk", className: "bg-destructive/15 text-destructive border-destructive/30" },
  }[state];
  return (
    <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div className={`inline-block px-2.5 py-1 rounded-md border text-xs font-medium ${meta.className}`}>{meta.label}</div>
        <p className="mt-2 text-sm text-muted-foreground">
          {remaining.toFixed(1)} blocks of work left · {upcoming} blocks remaining this week
        </p>
      </div>
      <div className="text-right">
        <div className="text-3xl font-semibold tabular-nums">{diff >= 0 ? "+" : ""}{diff}</div>
        <div className="text-xs text-muted-foreground">block buffer</div>
      </div>
    </Card>
  );
}

function TimerPanel({
  block, stages, videoId, now, onChanged,
}: { block: any | null; stages: any[]; videoId: string; now: Date; onChanged: () => void }) {
  const stage = block ? stages.find((s) => s.id === block.assigned_stage_id) : null;
  const stageLabel = stage ? STAGE_LABEL[stage.kind as StageKind] : "Unassigned";
  const isActive = block?.status === "in_progress";

  // Phase: work | break
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [breakStart, setBreakStart] = useState<number | null>(null);
  const [wrapping, setWrapping] = useState(false);
  const [pct, setPct] = useState(50);
  const [fullBlock, setFullBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const chimedWorkRef = useRef(false);
  const chimedBreakRef = useRef(false);

  useEffect(() => {
    if (!isActive) { setPhase("work"); setBreakStart(null); chimedWorkRef.current = false; chimedBreakRef.current = false; }
    if (stage) setPct(Math.min(100, Math.round((Number(stage.actual_blocks) / Math.max(0.01, Number(stage.planned_blocks))) * 100)));
  }, [block?.id, isActive]);

  const elapsed = isActive && block?.clock_in_at
    ? Date.now() - new Date(block.clock_in_at).getTime()
    : 0;
  const workRemaining = Math.max(0, WORK_MS - elapsed);
  const breakElapsed = breakStart ? Date.now() - breakStart : 0;
  const breakRemaining = Math.max(0, BREAK_MS - breakElapsed);

  // Auto-trigger break when work hour is up
  useEffect(() => {
    if (isActive && phase === "work" && workRemaining === 0 && !chimedWorkRef.current) {
      chimedWorkRef.current = true;
      toast.info("Hour's up — take a 15-minute break.");
      setPhase("break");
      setBreakStart(Date.now());
    }
    if (phase === "break" && breakRemaining === 0 && breakStart && !chimedBreakRef.current) {
      chimedBreakRef.current = true;
      toast.success("Break's over. Back to work.");
    }
  }, [isActive, phase, workRemaining, breakRemaining, breakStart]);

  const clockIn = async () => {
    if (!block) return;
    setBusy(true);
    const { error } = await supabase
      .from("work_blocks")
      .update({ status: "in_progress", clock_in_at: new Date().toISOString() })
      .eq("id", block.id);
    setBusy(false);
    if (error) { toast.error(`Clock-in failed: ${error.message}`); return; }
    toast.success("Clocked in.");
    onChanged();
  };

  const skip = async () => {
    if (!block) return;
    setBusy(true);
    const { error } = await supabase.from("work_blocks").update({ status: "skipped" }).eq("id", block.id);
    if (!error) {
      const r = await applyRebalance(videoId);
      if (!r.ok) toast.error(`Rebalance failed: ${r.error}`);
    }
    setBusy(false);
    if (error) { toast.error(`Skip failed: ${error.message}`); return; }
    toast.success("Block skipped.");
    onChanged();
  };

  const confirmWrap = async () => {
    if (!block) return;
    setBusy(true);
    const start = block.clock_in_at ? new Date(block.clock_in_at) : new Date();
    const end = new Date();
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const portion = fullBlock ? 1 : Math.min(1, minutes / 180);

    const { error: bErr } = await supabase.from("work_blocks").update({
      status: "done", clock_out_at: end.toISOString(), actual_minutes: minutes,
    }).eq("id", block.id);
    if (bErr) { setBusy(false); toast.error(`Clock-out failed: ${bErr.message}`); return; }

    if (stage) {
      const newActual = Number(stage.actual_blocks) + portion;
      const { error: sErr } = await supabase.from("stages").update({
        actual_blocks: newActual, percent_complete: pct, completed: pct >= 100,
      }).eq("id", stage.id);
      if (sErr) { setBusy(false); toast.error(`Stage update failed: ${sErr.message}`); return; }
    }
    const r = await applyRebalance(videoId);
    setBusy(false);
    if (!r.ok) toast.error(`Rebalance failed: ${r.error}`);
    else toast.success("Clocked out.");
    setWrapping(false);
    onChanged();
  };

  // No active block — show next-up
  if (!isActive) {
    if (!block) {
      return (
        <Card className="p-8 text-center">
          <div className="text-muted-foreground">Nothing scheduled coming up. Enjoy the break.</div>
        </Card>
      );
    }
    const startsIn = new Date(block.scheduled_start).getTime() - now.getTime();
    const isNow = startsIn <= 0;
    return (
      <Card className="p-8 flex flex-col items-center text-center gap-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {isNow ? "Ready to start" : "Next block"}
        </div>
        <div className="text-3xl font-semibold">{stageLabel}</div>
        <div className="text-sm text-muted-foreground tabular-nums">
          {new Date(block.scheduled_start).toLocaleDateString([], { weekday: "short" })}{" "}
          {fmtTime(block.scheduled_start)} – {fmtTime(block.scheduled_end)}
          {!isNow && <> · in {fmtCountdown(startsIn)}</>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="lg" onClick={clockIn} disabled={busy}>
            <Play className="size-4 mr-2" /> Clock in
          </Button>
          <Button size="lg" variant="ghost" onClick={skip} disabled={busy}>
            <SkipForward className="size-4 mr-2" /> Skip
          </Button>
        </div>
      </Card>
    );
  }

  // Active — work or break
  if (phase === "break") {
    const ringPct = (breakElapsed / BREAK_MS) * 100;
    return (
      <Card className="p-8 flex flex-col items-center text-center gap-4">
        <div className="flex items-center gap-2 text-amber-600 text-xs uppercase tracking-wider">
          <Coffee className="size-4" /> Break
        </div>
        <TimerRing pct={Math.min(100, ringPct)} label={fmtClock(breakRemaining)} accent="amber" />
        <div className="text-sm text-muted-foreground">15-minute breather. Stand up, hydrate.</div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { setPhase("work"); chimedWorkRef.current = false; }}>
            Back to work
          </Button>
        </div>
      </Card>
    );
  }

  const ringPct = Math.min(100, (elapsed / WORK_MS) * 100);
  return (
    <Card className="p-8 flex flex-col items-center text-center gap-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Working on</div>
      <div className="text-2xl font-semibold">{stageLabel}</div>
      <TimerRing pct={ringPct} label={fmtClock(elapsed)} accent="primary" />
      <div className="text-xs text-muted-foreground tabular-nums">
        {workRemaining > 0 ? <>{fmtClock(workRemaining)} until break</> : <>break time</>}
      </div>
      {!wrapping ? (
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setWrapping(true)}>
            <Square className="size-4 mr-2" /> Clock out
          </Button>
        </div>
      ) : (
        <div className="w-full max-w-md mt-2 pt-4 border-t border-border space-y-3 text-left">
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
            <Button size="sm" onClick={confirmWrap} disabled={busy}>{busy ? "Saving…" : "Confirm"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function TimerRing({ pct, label, accent }: { pct: number; label: string; accent: "primary" | "amber" }) {
  const size = 220;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const color = accent === "primary" ? "hsl(var(--primary))" : "rgb(217 119 6)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--border))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s linear" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-4xl font-light tabular-nums tracking-tight">
        {label}
      </div>
    </div>
  );
}

function TodayPage() { return <AppShell><TodayPageInner /></AppShell>; }
