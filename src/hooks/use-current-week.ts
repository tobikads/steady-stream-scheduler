import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureCurrentWeek, markOverdueBlocks } from "@/lib/week-setup";
import type { StageRow, VideoRow, WorkBlockRow } from "@/lib/db-types";
import { getErrorMessage } from "@/lib/db-types";
import { loadLocalWeek } from "@/lib/local-week";

export interface VideoBundle {
  videoId: string;
  video: VideoRow;
  stages: StageRow[];
  blocks: WorkBlockRow[];
}

export function useCurrentWeek() {
  const [data, setData] = useState<VideoBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"supabase" | "local">("supabase");
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setCloudError(null);
      try {
        const { data: userData, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const user = userData.user;
        if (!user) {
          if (cancelled) return;
          setData(loadLocalWeek());
          setMode("local");
          return;
        }
        const videoId = await ensureCurrentWeek(user.id);
        await markOverdueBlocks(videoId);
        const [
          { data: video, error: videoErr },
          { data: stages, error: stagesErr },
          { data: blocks, error: blocksErr },
        ] = await Promise.all([
          supabase.from("videos").select("*").eq("id", videoId).single(),
          supabase.from("stages").select("*").eq("video_id", videoId).order("order_index"),
          supabase.from("work_blocks").select("*").eq("video_id", videoId).order("scheduled_start"),
        ]);
        if (videoErr || stagesErr || blocksErr || !video) {
          throw videoErr ?? stagesErr ?? blocksErr ?? new Error("Video week failed to load.");
        }
        if (cancelled) return;
        setData({
          videoId,
          video: video as VideoRow,
          stages: (stages ?? []) as StageRow[],
          blocks: (blocks ?? []) as WorkBlockRow[],
        });
        setMode("supabase");
      } catch (err) {
        if (!cancelled) {
          setData(loadLocalWeek());
          setMode("local");
          setCloudError(getErrorMessage(err, "Cloud sync failed. Using local mode."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, error, mode, cloudError, refresh };
}
