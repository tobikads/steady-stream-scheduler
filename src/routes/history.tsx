import { AppShell } from "@/components/AppShell";
import { CloudSyncNotice } from "@/components/CloudSyncNotice";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STAGE_LABEL, STAGE_ORDER, dateToISODate, getMondayOf } from "@/lib/schedule";
import type { StageRow, VideoRow, WorkBlockRow } from "@/lib/db-types";
import { getErrorMessage } from "@/lib/db-types";
import { loadLocalWeeks } from "@/lib/local-week";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
  head: () => ({
    meta: [
      { title: "History - YT Video Scheduler" },
      { name: "description", content: "Past weeks: planned vs actual per stage." },
    ],
  }),
});

type HistoryWeek = {
  video: VideoRow;
  stages: StageRow[];
  blocks: WorkBlockRow[];
};

function dateLabel(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function updatedMs(video: VideoRow) {
  return new Date(video.updated_at ?? video.created_at).getTime();
}

function dedupeVideoRows(videos: VideoRow[]) {
  const byWeek = new Map<string, VideoRow>();
  for (const video of videos) {
    const existing = byWeek.get(video.week_start);
    if (!existing || updatedMs(video) >= updatedMs(existing)) {
      byWeek.set(video.week_start, video);
    }
  }
  return [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
}

function localHistoryWeeks(): HistoryWeek[] {
  return loadLocalWeeks().map((week) => ({
    video: week.video,
    stages: week.stages,
    blocks: week.blocks,
  }));
}

function mergeHistoryWeeks(cloudWeeks: HistoryWeek[], localWeeks: HistoryWeek[]) {
  const byWeek = new Map<string, HistoryWeek>();
  for (const week of cloudWeeks) byWeek.set(week.video.week_start, week);
  for (const week of localWeeks) {
    const existing = byWeek.get(week.video.week_start);
    if (!existing || updatedMs(week.video) >= updatedMs(existing.video)) {
      byWeek.set(week.video.week_start, week);
    }
  }
  return [...byWeek.values()].sort((a, b) => b.video.week_start.localeCompare(a.video.week_start));
}

function HistoryPageInner() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [stagesByVideo, setStagesByVideo] = useState<Record<string, StageRow[]>>({});
  const [blocksByVideo, setBlocksByVideo] = useState<Record<string, WorkBlockRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"supabase" | "local">("supabase");
  const [tick, setTick] = useState(0);
  const currentWeekStart = dateToISODate(getMondayOf(new Date()));
  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    const applyWeeks = (weeks: HistoryWeek[], nextMode: "supabase" | "local") => {
      if (cancelled) return;
      setVideos(weeks.map((week) => week.video));
      setStagesByVideo(
        Object.fromEntries(weeks.map((week) => [week.video.id, week.stages])) as Record<
          string,
          StageRow[]
        >,
      );
      setBlocksByVideo(
        Object.fromEntries(weeks.map((week) => [week.video.id, week.blocks])) as Record<
          string,
          WorkBlockRow[]
        >,
      );
      setMode(nextMode);
    };

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;

        const localWeeks = localHistoryWeeks();
        if (!userData.user) {
          applyWeeks(localWeeks, "local");
          return;
        }

        const { data: vids, error: videosErr } = await supabase
          .from("videos")
          .select("*")
          .eq("user_id", userData.user.id)
          .order("week_start", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(52);
        if (videosErr) throw videosErr;

        const cloudVideos = dedupeVideoRows((vids ?? []) as VideoRow[]);
        const grouped: Record<string, StageRow[]> = {};
        const blockGroups: Record<string, WorkBlockRow[]> = {};
        if (cloudVideos.length > 0) {
          const videoIds = cloudVideos.map((video) => video.id);
          const [{ data: stages, error: stagesErr }, { data: blocks, error: blocksErr }] =
            await Promise.all([
              supabase.from("stages").select("*").in("video_id", videoIds),
              supabase.from("work_blocks").select("*").in("video_id", videoIds),
            ]);
          if (stagesErr) throw stagesErr;
          if (blocksErr) throw blocksErr;
          for (const stage of (stages ?? []) as StageRow[]) {
            (grouped[stage.video_id] ??= []).push(stage);
          }
          for (const block of (blocks ?? []) as WorkBlockRow[]) {
            (blockGroups[block.video_id] ??= []).push(block);
          }
        }

        const cloudWeeks = cloudVideos.map((video) => ({
          video,
          stages: grouped[video.id] ?? [],
          blocks: blockGroups[video.id] ?? [],
        }));
        applyWeeks(mergeHistoryWeeks(cloudWeeks, localWeeks), "supabase");
      } catch (err) {
        if (!cancelled) {
          applyWeeks(localHistoryWeeks(), "local");
          setError(getErrorMessage(err, "Cloud history failed. Showing local history."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const accuracy: Record<string, { ratios: number[]; avg: number }> = {};
  for (const stages of Object.values(stagesByVideo)) {
    for (const stage of stages) {
      const planned = Number(stage.planned_blocks);
      const actual = Number(stage.actual_blocks);
      if (planned <= 0 || actual <= 0) continue;
      const record = (accuracy[stage.kind] ??= { ratios: [], avg: 0 });
      record.ratios.push(actual / planned);
    }
  }
  for (const key of Object.keys(accuracy)) {
    const ratios = accuracy[key].ratios;
    accuracy[key].avg = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (error && videos.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <Card className="p-6 space-y-3">
          <h1 className="text-lg font-semibold">History did not load</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button onClick={refresh}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            Planned vs actual blocks by production week.
          </p>
        </div>
        <Badge variant="outline">
          {videos.length} week{videos.length === 1 ? "" : "s"}
        </Badge>
      </div>

      {mode === "local" && (
        <CloudSyncNotice message={error} onRetry={refresh} showSignIn={!error} />
      )}

      {Object.keys(accuracy).length > 0 && (
        <Card className="p-5">
          <h3 className="font-medium mb-1">Estimation accuracy</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Ratio of actual divided by planned blocks across saved weeks. 1.0 = spot on.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {STAGE_ORDER.filter((kind) => accuracy[kind]).map((kind) => {
              const average = accuracy[kind].avg;
              const tone =
                average > 1.15
                  ? "text-amber-600"
                  : average < 0.85
                    ? "text-primary"
                    : "text-foreground";
              return (
                <div key={kind}>
                  <div className="text-xs text-muted-foreground">{STAGE_LABEL[kind]}</div>
                  <div className={`font-medium tabular-nums ${tone}`}>{average.toFixed(2)}x</div>
                  <div className="text-[10px] text-muted-foreground">
                    {accuracy[kind].ratios.length} sample
                    {accuracy[kind].ratios.length === 1 ? "" : "s"}
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
        videos.map((video) => {
          const stages = (stagesByVideo[video.id] ?? []).sort(
            (a, b) => a.order_index - b.order_index,
          );
          const blocks = blocksByVideo[video.id] ?? [];
          const planned = stages.reduce((sum, stage) => sum + Number(stage.planned_blocks), 0);
          const actual = stages.reduce((sum, stage) => sum + Number(stage.actual_blocks), 0);
          const isCurrent = video.week_start === currentWeekStart;
          return (
            <Card key={video.id} className="p-5" data-session-count={blocks.length}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{video.title}</h3>
                    {isCurrent && (
                      <Badge variant="outline" className="text-[10px]">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Week of {dateLabel(video.week_start)} - release {dateLabel(video.release_date)}
                  </p>
                </div>
                <Badge variant={video.status === "released" ? "default" : "outline"}>
                  {video.status.replace("_", " ")}
                </Badge>
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
                  {stages.map((stage) => {
                    const plannedBlocks = Number(stage.planned_blocks);
                    const actualBlocks = Number(stage.actual_blocks);
                    const diff = actualBlocks - plannedBlocks;
                    return (
                      <tr key={stage.id} className="border-t border-border">
                        <td className="py-1.5">{STAGE_LABEL[stage.kind]}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {plannedBlocks.toFixed(1)}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {actualBlocks.toFixed(1)}
                        </td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${
                            diff > 0
                              ? "text-amber-600"
                              : diff < 0
                                ? "text-primary"
                                : "text-muted-foreground"
                          }`}
                        >
                          {diff > 0 ? "+" : ""}
                          {diff.toFixed(1)}
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

function HistoryPage() {
  return (
    <AppShell>
      <HistoryPageInner />
    </AppShell>
  );
}
