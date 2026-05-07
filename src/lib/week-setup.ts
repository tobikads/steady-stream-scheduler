import { supabase } from "@/integrations/supabase/client";
import {
  STAGE_DEFAULTS,
  STAGE_ORDER,
  WEEK_TEMPLATE,
  buildBlockTimestamps,
  dateToISODate,
  getMondayOf,
  addDays,
  rebalance,
} from "./schedule";

/**
 * Ensures the current week's video, stages, and 16 work blocks exist for the user.
 * Returns the video id.
 */
export async function ensureCurrentWeek(userId: string): Promise<string> {
  const monday = getMondayOf(new Date());
  const weekStart = dateToISODate(monday);

  const { data: existing } = await supabase
    .from("videos")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (existing) return existing.id;

  const release = dateToISODate(addDays(monday, 5)); // Saturday

  const { data: video, error: vErr } = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      week_start: weekStart,
      release_date: release,
      title: `Video — week of ${weekStart}`,
    })
    .select("id")
    .single();
  if (vErr || !video) throw vErr ?? new Error("video insert failed");

  // Insert stages
  const stagesPayload = STAGE_ORDER.map((kind, i) => ({
    video_id: video.id,
    user_id: userId,
    kind,
    order_index: i,
    planned_blocks: STAGE_DEFAULTS[kind].default,
  }));
  const { data: stages, error: sErr } = await supabase
    .from("stages")
    .insert(stagesPayload)
    .select("*");
  if (sErr || !stages) throw sErr ?? new Error("stages insert failed");

  // Insert 16 work blocks
  const blocksPayload = WEEK_TEMPLATE.map((tpl) => {
    const { start, end } = buildBlockTimestamps(monday, tpl);
    return {
      video_id: video.id,
      user_id: userId,
      day_of_week: tpl.day_of_week,
      slot: tpl.slot,
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
    };
  });
  const { data: blocks, error: bErr } = await supabase
    .from("work_blocks")
    .insert(blocksPayload)
    .select("*");
  if (bErr || !blocks) throw bErr ?? new Error("blocks insert failed");

  // Initial assignment via rebalance
  await applyRebalance(video.id);

  return video.id;
}

export async function applyRebalance(videoId: string) {
  const [{ data: stages }, { data: blocks }] = await Promise.all([
    supabase.from("stages").select("*").eq("video_id", videoId),
    supabase.from("work_blocks").select("*").eq("video_id", videoId),
  ]);
  if (!stages || !blocks) return;

  const assignments = rebalance(
    stages.map((s) => ({
      id: s.id,
      kind: s.kind as any,
      order_index: s.order_index,
      planned_blocks: Number(s.planned_blocks),
      actual_blocks: Number(s.actual_blocks),
      percent_complete: s.percent_complete,
      completed: s.completed,
    })),
    blocks.map((b) => ({
      id: b.id,
      day_of_week: b.day_of_week,
      slot: b.slot as any,
      scheduled_start: b.scheduled_start,
      assigned_stage_id: b.assigned_stage_id,
      assigned_portion: Number(b.assigned_portion),
      status: b.status,
    }))
  );

  // Batch updates (one round trip per block; small N=16 max)
  await Promise.all(
    assignments.map((a) =>
      supabase
        .from("work_blocks")
        .update({ assigned_stage_id: a.stageId, assigned_portion: a.portion })
        .eq("id", a.blockId)
    )
  );
}
