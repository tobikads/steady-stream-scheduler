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
  Slot,
  StageKind,
} from "./schedule";
import { isRecoveryBlock } from "./catch-up";

async function findWeekVideo(userId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("videos")
    .select("id, updated_at, created_at")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function seedWeek(userId: string, monday: Date): Promise<string> {
  const weekStart = dateToISODate(monday);
  const release = dateToISODate(addDays(monday, 5));

  const { data: video, error: vErr } = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      week_start: weekStart,
      release_date: release,
      title: `Video - week of ${weekStart}`,
    })
    .select("id")
    .single();
  if (vErr || !video) throw vErr ?? new Error("video insert failed");

  const stagesPayload = STAGE_ORDER.map((kind, i) => ({
    video_id: video.id,
    user_id: userId,
    kind,
    order_index: i,
    planned_blocks: STAGE_DEFAULTS[kind].default,
  }));
  const { error: sErr } = await supabase.from("stages").insert(stagesPayload);
  if (sErr) throw sErr;

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
  const { error: bErr } = await supabase.from("work_blocks").insert(blocksPayload);
  if (bErr) throw bErr;

  const rebalanceResult = await applyRebalance(video.id);
  if (!rebalanceResult.ok) throw new Error(rebalanceResult.error ?? "rebalance failed");
  return video.id;
}

async function syncStageDefaults(videoId: string) {
  const { data: stages, error } = await supabase
    .from("stages")
    .select("id, kind, planned_blocks")
    .eq("video_id", videoId);
  if (error) throw error;

  const updates = (stages ?? [])
    .map((stage) => {
      const defaultPlan = STAGE_DEFAULTS[stage.kind as StageKind];
      if (!defaultPlan) return null;
      return {
        id: stage.id,
        plannedBlocks: defaultPlan.default,
        currentBlocks: Number(stage.planned_blocks),
      };
    })
    .filter((stage): stage is NonNullable<typeof stage> => stage !== null)
    .filter((stage) => stage.currentBlocks !== stage.plannedBlocks);

  if (updates.length === 0) return false;

  const results = await Promise.all(
    updates.map((stage) =>
      supabase.from("stages").update({ planned_blocks: stage.plannedBlocks }).eq("id", stage.id),
    ),
  );
  const firstErr = results.find((result) => result.error)?.error;
  if (firstErr) throw firstErr;
  return true;
}

export async function ensureCurrentWeek(userId: string): Promise<string> {
  const monday = getMondayOf(new Date());
  const weekStart = dateToISODate(monday);

  const existing = await findWeekVideo(userId, weekStart);

  if (existing) {
    const defaultsChanged = await syncStageDefaults(existing.id);
    // Self-heal: if blocks exist but none are assigned, run rebalance.
    const { data: anyAssigned, error: assignedErr } = await supabase
      .from("work_blocks")
      .select("id")
      .eq("video_id", existing.id)
      .not("assigned_stage_id", "is", null)
      .limit(1);
    if (assignedErr) throw assignedErr;
    if (defaultsChanged || !anyAssigned || anyAssigned.length === 0) {
      const rebalanceResult = await applyRebalance(existing.id);
      if (!rebalanceResult.ok) throw new Error(rebalanceResult.error ?? "rebalance failed");
    }
    return existing.id;
  }

  return seedWeek(userId, monday);
}

export async function createNextWeek(userId: string): Promise<string> {
  const thisMonday = getMondayOf(new Date());
  const nextMonday = addDays(thisMonday, 7);
  const weekStart = dateToISODate(nextMonday);
  const existing = await findWeekVideo(userId, weekStart);
  if (existing) return existing.id;
  return seedWeek(userId, nextMonday);
}

export async function markOverdueBlocks(videoId: string): Promise<number> {
  const { data: overdue, error: loadErr } = await supabase
    .from("work_blocks")
    .select("id")
    .eq("video_id", videoId)
    .eq("status", "upcoming")
    .lt("scheduled_end", new Date().toISOString());
  if (loadErr) throw loadErr;

  const ids = (overdue ?? []).map((block) => block.id);
  if (ids.length === 0) return 0;

  const { error: updateErr } = await supabase
    .from("work_blocks")
    .update({
      status: "missed",
      clock_in_at: null,
      clock_out_at: null,
      actual_minutes: 0,
    })
    .in("id", ids);
  if (updateErr) throw updateErr;

  const rebalanceResult = await applyRebalance(videoId);
  if (!rebalanceResult.ok) throw new Error(rebalanceResult.error ?? "rebalance failed");
  return ids.length;
}

export async function applyRebalance(videoId: string): Promise<{ ok: boolean; error?: string }> {
  const [{ data: stages, error: sErr }, { data: blocks, error: bErr }] = await Promise.all([
    supabase.from("stages").select("*").eq("video_id", videoId),
    supabase.from("work_blocks").select("*").eq("video_id", videoId),
  ]);
  if (sErr || bErr || !stages || !blocks) {
    return { ok: false, error: sErr?.message ?? bErr?.message ?? "load failed" };
  }

  const assignments = rebalance(
    stages.map((s) => ({
      id: s.id,
      kind: s.kind as StageKind,
      order_index: s.order_index,
      planned_blocks: Number(s.planned_blocks),
      actual_blocks: Number(s.actual_blocks),
      percent_complete: s.percent_complete,
      completed: s.completed,
    })),
    blocks.map((b) => ({
      id: b.id,
      day_of_week: b.day_of_week,
      slot: b.slot as Slot,
      scheduled_start: b.scheduled_start,
      assigned_stage_id: b.assigned_stage_id,
      assigned_portion: Number(b.assigned_portion),
      status: b.status,
      is_catch_up: isRecoveryBlock(b),
    })),
  );

  const results = await Promise.all(
    assignments.map((a) =>
      supabase
        .from("work_blocks")
        .update({ assigned_stage_id: a.stageId, assigned_portion: a.portion })
        .eq("id", a.blockId),
    ),
  );
  const firstErr = results.find((r) => r.error)?.error;
  if (firstErr) return { ok: false, error: firstErr.message };
  return { ok: true };
}
