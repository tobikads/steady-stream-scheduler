import { AppShell } from "@/components/AppShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { applyRebalance } from "@/lib/week-setup";
import { STAGE_LABEL } from "@/lib/schedule";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  Circle,
  Coffee,
  ListChecks,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  Play,
  SkipForward,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { StageRow, WorkBlockRow } from "@/lib/db-types";
import {
  rebalanceLocalWeek,
  saveLocalTitle,
  updateLocalBlock,
  updateLocalStage,
} from "@/lib/local-week";
import {
  PAUSE_REASONS,
  STAGE_CHECKLISTS,
  type PauseReasonId,
  type ProductivityState,
  useProductivityState,
} from "@/hooks/use-productivity-state";

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
const COMPLETION_OPTIONS = [
  { label: "25%", value: 0.25 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "100%", value: 1 },
];

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
function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function TodayPageInner() {
  const { data, loading, error, mode, cloudError, refresh } = useCurrentWeek();
  const productivity = useProductivityState(data?.videoId);
  const [now, setNow] = useState(new Date());
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const cancelTitleRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (data) setTitleDraft(data.video.title);
  }, [data]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading your week…</div>;
  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">Today did not load</h1>
          <p className="text-sm text-muted-foreground">{error ?? "Video data was unavailable."}</p>
          <Button onClick={refresh}>Try again</Button>
        </Card>
      </div>
    );
  }

  const todayBlocks = data.blocks
    .filter((b) => isSameLocalDay(b.scheduled_start, now))
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  const activeBlock = data.blocks.find((b) => b.status === "in_progress");
  const nextBlock =
    activeBlock ??
    todayBlocks.find(
      (b) => b.status === "upcoming" && new Date(b.scheduled_end).getTime() >= now.getTime(),
    ) ??
    data.blocks
      .filter(
        (b) => b.status === "upcoming" && new Date(b.scheduled_end).getTime() >= now.getTime(),
      )
      .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start))[0];
  const focusStage = nextBlock
    ? data.stages.find((stage) => stage.id === nextBlock.assigned_stage_id)
    : null;

  const saveTitle = async () => {
    if (cancelTitleRef.current) {
      cancelTitleRef.current = false;
      setTitleDraft(data.video.title);
      return;
    }
    const next = titleDraft.trim() || "Untitled video";
    if (next === data.video.title) {
      setEditingTitle(false);
      return;
    }
    setEditingTitle(false);
    if (mode === "local") {
      saveLocalTitle(next);
      toast.success("Title updated locally.");
      refresh();
      return;
    }

    const { error } = await supabase.from("videos").update({ title: next }).eq("id", data.videoId);
    if (error) {
      toast.error(`Couldn't save title: ${error.message}`);
      setEditingTitle(true);
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
                cancelTitleRef.current = true;
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

      {cloudError && <CloudNotice message={cloudError} />}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground mb-3">
          Today - {now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
        </h2>
        {todayBlocks.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">No scheduled blocks today.</Card>
        ) : (
          <Card className="p-2 divide-y divide-border">
            {todayBlocks.map((b) => {
              const stage = data.stages.find((s) => s.id === b.assigned_stage_id);
              const meta = badgeMeta(b.status);
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {b.slot}
                    </Badge>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtTime(b.scheduled_start)} - {fmtTime(b.scheduled_end)}
                    </span>
                    <span className="font-medium">{stage ? STAGE_LABEL[stage.kind] : "-"}</span>
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
          See{" "}
          <Link to="/week" className="underline">
            the week view
          </Link>{" "}
          for stage progress and the full schedule.
        </p>
      </section>

      <TimerPanel
        block={nextBlock ?? null}
        stages={data.stages}
        videoId={data.videoId}
        now={now}
        mode={mode}
        onPause={productivity.logPause}
        onChanged={refresh}
      />

      <TaskList
        stage={focusStage ?? null}
        state={productivity.state}
        onToggleStageTask={productivity.toggleStageItem}
        onAddTask={productivity.addTask}
        onToggleTask={productivity.toggleTask}
        onDeleteTask={productivity.deleteTask}
        onRenameTask={productivity.renameTask}
        onRenameStageTask={productivity.renameStageTask}
      />
    </div>
  );
}

function CloudNotice({ message }: { message: string }) {
  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/10 text-sm text-amber-800">
      Cloud sync is unavailable, so this page is running in local mode. {message}
    </Card>
  );
}

function TaskList({
  stage,
  state,
  onToggleStageTask,
  onAddTask,
  onToggleTask,
  onDeleteTask,
  onRenameTask,
  onRenameStageTask,
}: {
  stage: StageRow | null;
  state: ProductivityState;
  onToggleStageTask: (stageId: string, itemId: string) => void;
  onAddTask: (label: string, minutes?: number) => void;
  onToggleTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onRenameTask: (taskId: string, label: string) => void;
  onRenameStageTask: (stageId: string, itemId: string, label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const stageTasks = stage
    ? STAGE_CHECKLISTS[stage.kind].map((item) => ({
        id: item.id,
        label: state.stageTaskLabelOverrides[stage.id]?.[item.id] ?? item.label,
        completed: state.checkedStageItems[stage.id]?.[item.id] ?? false,
        source: "stage" as const,
      }))
    : [];
  const customTasks = state.tasks.map((task) => ({
    id: task.id,
    label: task.label,
    completed: task.completed,
    source: "custom" as const,
  }));
  const tasks = [...customTasks, ...stageTasks];

  const addTask = () => {
    onAddTask(draft);
    setDraft("");
    setAdding(false);
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListChecks className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">Tasks</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAdding((value) => !value)}
            aria-label="Add task"
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant={editing ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setEditing((value) => !value)}
            aria-label={editing ? "Stop editing tasks" : "Edit tasks"}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        You are focusing on{" "}
        <span className="font-medium text-foreground">
          {stage ? STAGE_LABEL[stage.kind] : "your next video task"}
        </span>
      </p>

      {adding && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addTask();
              if (event.key === "Escape") {
                setDraft("");
                setAdding(false);
              }
            }}
            placeholder="Add a task"
          />
          <Button onClick={addTask}>Add</Button>
        </div>
      )}

      <div className="grid gap-2">
        {tasks.length === 0 ? (
          <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No tasks yet.
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={`${task.source}-${task.id}`}
              className="group flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <button
                type="button"
                className="mt-0.5 shrink-0"
                onClick={() => {
                  if (task.source === "stage" && stage) {
                    onToggleStageTask(stage.id, task.id);
                    return;
                  }
                  if (task.source === "custom") onToggleTask(task.id);
                }}
                aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"}
              >
                {task.completed ? (
                  <CheckCircle2 className="size-5 text-primary" />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                {editing ? (
                  <Input
                    value={task.label}
                    onChange={(event) => {
                      if (task.source === "stage" && stage) {
                        onRenameStageTask(stage.id, task.id, event.target.value);
                        return;
                      }
                      if (task.source === "custom") onRenameTask(task.id, event.target.value);
                    }}
                    className="h-8"
                  />
                ) : (
                  <button
                    type="button"
                    className={`block w-full truncate text-left ${
                      task.completed ? "text-muted-foreground line-through" : "text-foreground"
                    }`}
                    onClick={() => {
                      if (task.source === "stage" && stage) {
                        onToggleStageTask(stage.id, task.id);
                        return;
                      }
                      if (task.source === "custom") onToggleTask(task.id);
                    }}
                  >
                    {task.label}
                  </button>
                )}
              </div>
              {task.source === "custom" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={editing ? "" : "opacity-0 transition-opacity group-hover:opacity-100"}
                  onClick={() => onDeleteTask(task.id)}
                  aria-label="Delete task"
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function badgeMeta(status: string) {
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

function TimerPanel({
  block,
  stages,
  videoId,
  now,
  mode,
  onPause,
  onChanged,
}: {
  block: WorkBlockRow | null;
  stages: StageRow[];
  videoId: string;
  now: Date;
  mode: "supabase" | "local";
  onPause: (event: {
    blockId: string;
    stageId: string | null;
    reason: PauseReasonId;
    phase: "work" | "break";
  }) => void;
  onChanged: () => void;
}) {
  const stage = block ? stages.find((s) => s.id === block.assigned_stage_id) : null;
  const stageLabel = stage ? STAGE_LABEL[stage.kind] : "Unassigned";
  const isActive = block?.status === "in_progress";

  // Phase: work | break
  const [phase, setPhase] = useState<"work" | "break">("work");
  const [workStartedAt, setWorkStartedAt] = useState<number | null>(null);
  const [breakStart, setBreakStart] = useState<number | null>(null);
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [phasePausedMs, setPhasePausedMs] = useState(0);
  const [sessionPausedMs, setSessionPausedMs] = useState(0);
  const [choosingPauseReason, setChoosingPauseReason] = useState(false);
  const [wrapping, setWrapping] = useState(false);
  const [completionPortion, setCompletionPortion] = useState(1);
  const [busy, setBusy] = useState(false);
  const chimedWorkRef = useRef(false);
  const chimedBreakRef = useRef(false);

  useEffect(() => {
    if (!isActive) {
      setPhase("work");
      setWorkStartedAt(null);
      setBreakStart(null);
      setPausedAt(null);
      setPhasePausedMs(0);
      setSessionPausedMs(0);
      setChoosingPauseReason(false);
      setWrapping(false);
      setCompletionPortion(1);
      chimedWorkRef.current = false;
      chimedBreakRef.current = false;
    } else if (block?.clock_in_at) {
      setPhase("work");
      setWorkStartedAt(new Date(block.clock_in_at).getTime());
      setBreakStart(null);
      setPausedAt(null);
      setPhasePausedMs(0);
      setSessionPausedMs(0);
      setChoosingPauseReason(false);
      setWrapping(false);
      setCompletionPortion(1);
      chimedWorkRef.current = false;
      chimedBreakRef.current = false;
    }
  }, [block?.id, block?.clock_in_at, isActive]);

  const activePauseMs = phasePausedMs + (pausedAt ? Date.now() - pausedAt : 0);
  const sessionPauseMs = sessionPausedMs + (pausedAt ? Date.now() - pausedAt : 0);
  const isPaused = pausedAt !== null;
  const elapsed =
    isActive && workStartedAt ? Math.max(0, Date.now() - workStartedAt - activePauseMs) : 0;
  const workRemaining = Math.max(0, WORK_MS - elapsed);
  const breakElapsed = breakStart ? Math.max(0, Date.now() - breakStart - activePauseMs) : 0;
  const breakRemaining = Math.max(0, BREAK_MS - breakElapsed);

  // Auto-trigger break when work hour is up
  useEffect(() => {
    if (
      isActive &&
      !isPaused &&
      phase === "work" &&
      workRemaining === 0 &&
      !chimedWorkRef.current
    ) {
      chimedWorkRef.current = true;
      toast.info("Hour's up — take a 15-minute break.");
      setPhase("break");
      setBreakStart(Date.now());
      setPausedAt(null);
      setPhasePausedMs(0);
    }
    if (
      !isPaused &&
      phase === "break" &&
      breakRemaining === 0 &&
      breakStart &&
      !chimedBreakRef.current
    ) {
      chimedBreakRef.current = true;
      toast.success("Break's over. Back to work.");
    }
  }, [isActive, isPaused, phase, workRemaining, breakRemaining, breakStart]);

  const pauseTimer = (reason: PauseReasonId) => {
    if (pausedAt) return;
    if (block) {
      onPause({
        blockId: block.id,
        stageId: stage?.id ?? null,
        reason,
        phase,
      });
    }
    setPausedAt(Date.now());
    setChoosingPauseReason(false);
  };

  const resumeTimer = () => {
    if (!pausedAt) return;
    const delta = Date.now() - pausedAt;
    setPhasePausedMs((ms) => ms + delta);
    setSessionPausedMs((ms) => ms + delta);
    setPausedAt(null);
    setChoosingPauseReason(false);
  };

  const returnToWork = () => {
    setPhase("work");
    setWorkStartedAt(Date.now());
    setBreakStart(null);
    setPausedAt(null);
    setPhasePausedMs(0);
    setChoosingPauseReason(false);
    chimedWorkRef.current = false;
    chimedBreakRef.current = false;
  };

  const clockIn = async () => {
    if (!block) return;
    if (mode === "local") {
      updateLocalBlock(block.id, {
        status: "in_progress",
        clock_in_at: new Date().toISOString(),
        clock_out_at: null,
        actual_minutes: 0,
      });
      setPausedAt(null);
      setPhasePausedMs(0);
      setSessionPausedMs(0);
      setChoosingPauseReason(false);
      toast.success("Clocked in locally.");
      onChanged();
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("work_blocks")
      .update({
        status: "in_progress",
        clock_in_at: new Date().toISOString(),
        clock_out_at: null,
        actual_minutes: 0,
      })
      .eq("id", block.id);
    setBusy(false);
    if (error) {
      toast.error(`Clock-in failed: ${error.message}`);
      return;
    }
    toast.success("Clocked in.");
    onChanged();
  };

  const skip = async () => {
    if (!block) return;
    if (mode === "local") {
      updateLocalBlock(block.id, {
        status: "missed",
        clock_in_at: null,
        clock_out_at: null,
        actual_minutes: 0,
      });
      rebalanceLocalWeek();
      toast.success("Block marked missed locally.");
      onChanged();
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("work_blocks")
      .update({
        status: "missed",
        clock_in_at: null,
        clock_out_at: null,
        actual_minutes: 0,
      })
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
    toast.success("Block marked missed.");
    onChanged();
  };

  const confirmWrap = async () => {
    if (!block) return;
    setBusy(true);
    const start = block.clock_in_at ? new Date(block.clock_in_at) : new Date();
    const end = new Date();
    const minutes = Math.max(
      1,
      Math.round((end.getTime() - start.getTime() - sessionPauseMs) / 60000),
    );
    const portion = completionPortion;
    const nextStatus = portion >= 1 ? "done" : "partial";

    if (mode === "local") {
      updateLocalBlock(block.id, {
        status: nextStatus,
        clock_out_at: end.toISOString(),
        actual_minutes: minutes,
      });
      if (stage) {
        const newActual = Number(stage.actual_blocks) + portion;
        const plannedBlocks = Math.max(0.01, Number(stage.planned_blocks));
        updateLocalStage(stage.id, {
          actual_blocks: newActual,
          percent_complete: Math.min(100, Math.round((newActual / plannedBlocks) * 100)),
          completed: newActual >= plannedBlocks,
        });
      }
      rebalanceLocalWeek();
      setBusy(false);
      setWrapping(false);
      toast.success("Clocked out locally.");
      onChanged();
      return;
    }

    const { error: bErr } = await supabase
      .from("work_blocks")
      .update({
        status: nextStatus,
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
      const plannedBlocks = Math.max(0.01, Number(stage.planned_blocks));
      const { error: sErr } = await supabase
        .from("stages")
        .update({
          actual_blocks: newActual,
          percent_complete: Math.min(100, Math.round((newActual / plannedBlocks) * 100)),
          completed: newActual >= plannedBlocks,
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
    if (!r.ok) toast.error(`Rebalance failed: ${r.error}`);
    else toast.success("Clocked out.");
    setWrapping(false);
    onChanged();
  };

  const wrapControls = (
    <div className="w-full max-w-md mt-2 pt-4 border-t border-border space-y-3 text-left">
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">How much of this block did you finish?</div>
        <div className="grid grid-cols-4 gap-2">
          {COMPLETION_OPTIONS.map((option) => (
            <Button
              key={option.label}
              type="button"
              variant={completionPortion === option.value ? "default" : "outline"}
              size="sm"
              onClick={() => setCompletionPortion(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setWrapping(false)} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={confirmWrap} disabled={busy}>
          {busy ? "Saving…" : "Confirm"}
        </Button>
      </div>
    </div>
  );

  const pauseControls = (
    <div className="w-full max-w-md space-y-2">
      {choosingPauseReason && !isPaused && (
        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Pause reason
          </div>
          <div className="flex flex-wrap gap-2">
            {PAUSE_REASONS.map((reason) => (
              <Button
                key={reason.id}
                size="sm"
                variant="outline"
                onClick={() => pauseTimer(reason.id)}
              >
                {reason.label}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="outline"
          onClick={isPaused ? resumeTimer : () => setChoosingPauseReason((value) => !value)}
        >
          {isPaused ? <Play className="size-4 mr-2" /> : <Pause className="size-4 mr-2" />}
          {isPaused ? "Resume" : "Pause"}
        </Button>
      </div>
    </div>
  );

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
            <SkipForward className="size-4 mr-2" /> Mark missed
          </Button>
        </div>
      </Card>
    );
  }

  // Active — work or break
  if (phase === "break") {
    const ringPct = (breakRemaining / BREAK_MS) * 100;
    return (
      <Card className="p-8 flex flex-col items-center text-center gap-4">
        <div className="flex items-center gap-2 text-amber-600 text-xs uppercase tracking-wider">
          <Coffee className="size-4" /> Break
        </div>
        <TimerRing pct={Math.min(100, ringPct)} label={fmtClock(breakRemaining)} accent="amber" />
        <div className="text-sm text-muted-foreground">15-minute breather. Stand up, hydrate.</div>
        {!wrapping ? (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <Button onClick={returnToWork}>Back to work</Button>
              <Button variant="secondary" onClick={() => setWrapping(true)}>
                <Square className="size-4 mr-2" /> Clock out
              </Button>
            </div>
            {pauseControls}
          </div>
        ) : (
          wrapControls
        )}
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
        {isPaused ? (
          "Paused"
        ) : workRemaining > 0 ? (
          <>{fmtClock(workRemaining)} until break</>
        ) : (
          <>break time</>
        )}
      </div>
      {!wrapping ? (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setWrapping(true)}>
              <Square className="size-4 mr-2" /> Clock out
            </Button>
          </div>
          {pauseControls}
        </div>
      ) : (
        wrapControls
      )}
    </Card>
  );
}

function TimerRing({
  pct,
  label,
  accent,
}: {
  pct: number;
  label: string;
  accent: "primary" | "amber";
}) {
  const size = 280;
  const stroke = 10;
  const r = (size - stroke * 4) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const gradId = accent === "primary" ? "ringGradPrimary" : "ringGradAmber";
  const stops =
    accent === "primary"
      ? [
          { o: "0%", c: "oklch(0.82 0.18 200)" },
          { o: "50%", c: "oklch(0.72 0.17 245)" },
          { o: "100%", c: "oklch(0.6 0.2 285)" },
        ]
      : [
          { o: "0%", c: "oklch(0.85 0.15 90)" },
          { o: "100%", c: "oklch(0.72 0.18 50)" },
        ];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        className="absolute inset-0"
        style={{ animation: "timer-spin 18s linear infinite" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={(size - stroke) / 2}
          stroke="oklch(0.72 0.17 245 / 0.3)"
          strokeWidth={1}
          strokeDasharray="2 8"
          fill="none"
        />
      </svg>
      <svg width={size} height={size} className="-rotate-90 relative timer-glow">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {stops.map((s) => (
              <stop key={s.o} offset={s.o} stopColor={s.c} />
            ))}
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="oklch(1 0 0 / 0.06)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s linear" }}
        />
      </svg>
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90 opacity-40"
        viewBox={`0 0 ${size} ${size}`}
      >
        {Array.from({ length: 60 }).map((_, i) => {
          const angle = (i / 60) * 2 * Math.PI;
          const inner = r - stroke;
          const outer = r - stroke / 2 - (i % 5 === 0 ? 6 : 2);
          const x1 = size / 2 + Math.cos(angle) * inner;
          const y1 = size / 2 + Math.sin(angle) * inner;
          const x2 = size / 2 + Math.cos(angle) * outer;
          const y2 = size / 2 + Math.sin(angle) * outer;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="oklch(0.72 0.17 245)"
              strokeWidth={i % 5 === 0 ? 1.5 : 0.5}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-5xl font-extralight tabular-nums tracking-tight bg-gradient-to-br from-foreground to-primary bg-clip-text text-transparent">
          {label}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          {Math.round(pct)}% · {accent === "primary" ? "focus" : "rest"}
        </div>
      </div>
    </div>
  );
}

function TodayPage() {
  return (
    <AppShell>
      <TodayPageInner />
    </AppShell>
  );
}
