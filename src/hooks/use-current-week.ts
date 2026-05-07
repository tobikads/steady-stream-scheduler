import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureCurrentWeek } from "@/lib/week-setup";

export interface VideoBundle {
  videoId: string;
  video: any;
  stages: any[];
  blocks: any[];
}

export function useCurrentWeek() {
  const [data, setData] = useState<VideoBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) return;
        const videoId = await ensureCurrentWeek(user.id);
        const [{ data: video }, { data: stages }, { data: blocks }] = await Promise.all([
          supabase.from("videos").select("*").eq("id", videoId).single(),
          supabase.from("stages").select("*").eq("video_id", videoId).order("order_index"),
          supabase.from("work_blocks").select("*").eq("video_id", videoId).order("scheduled_start"),
        ]);
        if (cancelled) return;
        setData({
          videoId,
          video,
          stages: stages ?? [],
          blocks: blocks ?? [],
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, refresh };
}
