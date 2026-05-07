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

async function seedWeek(userId: string, monday: Date): Promise<string> {
  const weekStart = dateToISODate(monday);
  const release = dateToISODate(addDays(monday, 5));

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

  await applyRebalance(video.id);
  return video.id;
}

export async function ensureCurrentWeek(userId: string): Promise<string> {
  const monday = getMondayOf(new Date());
  const weekStart = dateToISODate(monday);

  const { data: existing } = await supabase
    .from("videos")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (existing) {
    // Self-heal: if blocks exist but none are assigned, run rebalance.
    const { data: anyAssigned } = await supabase
      .from("work_blocks")
      .select("id")
      .eq("video_id", existing.id)
      .not("assigned_stage_id", "is", null)
      .limit(1);
    if (!anyAssigned || anyAssigned.length === 0) {
      await applyRebalance(existing.id);
    }
    return existing.id;
  }

  return seedWeek(userId, monday);
}

export async function createNextWeek(userId: string): Promise<string> {
  const thisMonday = getMondayOf(new Date());
  const nextMonday = addDays(thisMonday, 7);
  const weekStart = dateToISODate(nextMonday);
  const { data: existing } = await supabase
    .from("videos")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing) return existing.id;
  return seedWeek(userId, nextMonday);
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

  const results = await Promise.all(
    assignments.map((a) =>
      supabase
        .from("work_blocks")
        .update({ assigned_stage_id: a.stageId, assigned_portion: a.portion })
        .eq("id", a.blockId)
    )
  );
  const firstErr = results.find((r) => r.error)?.error;
  if (firstErr) return { ok: false, error: firstErr.message };
  return { ok: true };
}
