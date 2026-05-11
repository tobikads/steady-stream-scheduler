import type { VideoBundle } from "@/hooks/use-current-week";
import type { StageRow, VideoRow, WorkBlockRow } from "@/lib/db-types";
import { isRecoveryBlock } from "@/lib/catch-up";
import {
  STAGE_DEFAULTS,
  STAGE_ORDER,
  WEEK_TEMPLATE,
  addDays,
  buildBlockTimestamps,
  dateToISODate,
  getMondayOf,
  isClosedBlockStatus,
  rebalance,
} from "@/lib/schedule";

const LOCAL_WEEK_KEY = "cadence.local.currentWeek";
const LOCAL_WEEKS_KEY = "cadence.local.weeks";

function nowIso() {
  return new Date().toISOString();
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function applyDefaultStagePlan(stages: StageRow[]) {
  return stages.map((stage) => ({
    ...stage,
    planned_blocks: STAGE_DEFAULTS[stage.kind].default,
  }));
}

function markOverdueMissed(blocks: WorkBlockRow[]) {
  const now = Date.now();
  return blocks.map((block) => {
    if (block.status !== "upcoming" || new Date(block.scheduled_end).getTime() >= now) {
      return block;
    }
    return {
      ...block,
      status: "missed" as const,
      clock_in_at: null,
      clock_out_at: null,
      actual_minutes: 0,
      updated_at: nowIso(),
    };
  });
}

function normalizeBlockDefaults(block: WorkBlockRow): WorkBlockRow {
  return {
    ...block,
    is_catch_up: isRecoveryBlock(block),
    planned_break_minutes:
      typeof block.planned_break_minutes === "number" ? block.planned_break_minutes : 15,
    pause_count: typeof block.pause_count === "number" ? block.pause_count : 0,
    pause_minutes: typeof block.pause_minutes === "number" ? block.pause_minutes : 0,
    task_snapshot: block.task_snapshot ?? null,
  };
}

function createLocalWeekFor(monday: Date): VideoBundle {
  const weekStart = dateToISODate(monday);
  const videoId = `local-video-${weekStart}`;
  const createdAt = nowIso();
  const video: VideoRow = {
    id: videoId,
    user_id: "local",
    title: `Video - week of ${weekStart}`,
    week_start: weekStart,
    release_date: dateToISODate(addDays(monday, 5)),
    status: "in_progress",
    created_at: createdAt,
    updated_at: createdAt,
  };

  const stages: StageRow[] = STAGE_ORDER.map((kind, orderIndex) => ({
    id: `local-stage-${weekStart}-${kind}`,
    video_id: videoId,
    user_id: "local",
    kind,
    order_index: orderIndex,
    planned_blocks: STAGE_DEFAULTS[kind].default,
    actual_blocks: 0,
    percent_complete: 0,
    completed: false,
    created_at: createdAt,
    updated_at: createdAt,
  }));

  const blocks: WorkBlockRow[] = WEEK_TEMPLATE.map((tpl) => {
    const { start, end } = buildBlockTimestamps(monday, tpl);
    return {
      id: `local-block-${weekStart}-${tpl.day_of_week}-${tpl.slot}`,
      video_id: videoId,
      user_id: "local",
      day_of_week: tpl.day_of_week,
      slot: tpl.slot,
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      assigned_stage_id: null,
      assigned_portion: 1,
      clock_in_at: null,
      clock_out_at: null,
      actual_minutes: 0,
      status: "upcoming",
      notes: null,
      is_catch_up: false,
      planned_break_minutes: tpl.breakAfterMinutes,
      pause_count: 0,
      pause_minutes: 0,
      task_snapshot: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  return rebalanceLocalBundle({ videoId, video, stages, blocks });
}

function normalizeBundle(bundle: VideoBundle): VideoBundle {
  const stages = applyDefaultStagePlan(bundle.stages);
  const overdueMarkedBlocks = markOverdueMissed(bundle.blocks.map(normalizeBlockDefaults));
  const assignments = rebalance(stages, overdueMarkedBlocks);
  const blocks = overdueMarkedBlocks.map((block) => {
    if (isClosedBlockStatus(block.status) || isRecoveryBlock(block)) return block;
    const assignment = assignments.find((item) => item.blockId === block.id);
    if (!assignment) return block;
    return {
      ...block,
      assigned_stage_id: assignment.stageId,
      assigned_portion: assignment.portion,
    };
  });
  const allStagesDone = stages.every(
    (stage) => stage.completed || Number(stage.actual_blocks) >= Number(stage.planned_blocks),
  );
  const releaseDatePassed = new Date(bundle.video.release_date).getTime() < Date.now();
  const completeAndPastRelease = allStagesDone && releaseDatePassed;
  return {
    ...bundle,
    stages,
    blocks,
    video: {
      ...bundle.video,
      status: completeAndPastRelease ? "released" : "in_progress",
      updated_at: bundle.video.updated_at,
    },
  };
}

function readLegacyCurrentWeek(): VideoBundle | null {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(LOCAL_WEEK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VideoBundle;
  } catch {
    localStorage.removeItem(LOCAL_WEEK_KEY);
    return null;
  }
}

function readWeeks(): VideoBundle[] {
  if (!canUseStorage()) return [];
  const raw = localStorage.getItem(LOCAL_WEEKS_KEY);
  const weeks: VideoBundle[] = [];
  if (raw) {
    try {
      weeks.push(...(JSON.parse(raw) as VideoBundle[]));
    } catch {
      localStorage.removeItem(LOCAL_WEEKS_KEY);
    }
  }

  const legacy = readLegacyCurrentWeek();
  if (legacy && !weeks.some((week) => week.video.week_start === legacy.video.week_start)) {
    weeks.push(legacy);
  }

  return dedupeWeeks(weeks.map(normalizeBundle));
}

function dedupeWeeks(weeks: VideoBundle[]) {
  const byWeek = new Map<string, VideoBundle>();
  for (const week of weeks) {
    const existing = byWeek.get(week.video.week_start);
    if (
      !existing ||
      new Date(week.video.updated_at).getTime() >= new Date(existing.video.updated_at).getTime()
    ) {
      byWeek.set(week.video.week_start, week);
    }
  }
  return [...byWeek.values()].sort((a, b) => b.video.week_start.localeCompare(a.video.week_start));
}

function saveWeeks(weeks: VideoBundle[]) {
  if (!canUseStorage()) return;
  const normalized = dedupeWeeks(weeks.map(normalizeBundle));
  localStorage.setItem(LOCAL_WEEKS_KEY, JSON.stringify(normalized));
  const currentWeek = dateToISODate(getMondayOf(new Date()));
  const current = normalized.find((week) => week.video.week_start === currentWeek);
  if (current) localStorage.setItem(LOCAL_WEEK_KEY, JSON.stringify(current));
}

function saveBundle(bundle: VideoBundle) {
  const weeks = readWeeks().filter((week) => week.video.week_start !== bundle.video.week_start);
  saveWeeks([...weeks, bundle]);
}

function rebalanceLocalBundle(bundle: VideoBundle): VideoBundle {
  const assignments = rebalance(bundle.stages, bundle.blocks);
  const blocks = bundle.blocks.map((block) => {
    if (isClosedBlockStatus(block.status) || isRecoveryBlock(block)) return block;
    const assignment = assignments.find((a) => a.blockId === block.id);
    if (!assignment) return block;
    return {
      ...block,
      assigned_stage_id: assignment.stageId,
      assigned_portion: assignment.portion,
      updated_at: nowIso(),
    };
  });
  return normalizeBundle({ ...bundle, blocks });
}

export function loadLocalWeeks(): VideoBundle[] {
  const weeks = readWeeks();
  const currentWeek = dateToISODate(getMondayOf(new Date()));
  if (weeks.some((week) => week.video.week_start === currentWeek)) return weeks;

  const current = createLocalWeekFor(getMondayOf(new Date()));
  const next = dedupeWeeks([...weeks, current]);
  saveWeeks(next);
  return next;
}

export function loadLocalWeek(): VideoBundle {
  if (!canUseStorage()) return createLocalWeekFor(getMondayOf(new Date()));

  const currentWeek = dateToISODate(getMondayOf(new Date()));
  const current = loadLocalWeeks().find((week) => week.video.week_start === currentWeek);
  if (current) {
    saveBundle(current);
    return current;
  }

  const bundle = createLocalWeekFor(getMondayOf(new Date()));
  saveBundle(bundle);
  return bundle;
}

export function updateLocalWeek(update: (bundle: VideoBundle) => VideoBundle) {
  const next = normalizeBundle(update(loadLocalWeek()));
  saveBundle(next);
  return next;
}

export function saveLocalTitle(title: string) {
  updateLocalWeek((bundle) => ({
    ...bundle,
    video: { ...bundle.video, title: title.trim() || "Untitled video", updated_at: nowIso() },
  }));
}

export function updateLocalBlock(blockId: string, patch: Partial<WorkBlockRow>) {
  updateLocalWeek((bundle) => ({
    ...bundle,
    blocks: bundle.blocks.map((block) =>
      block.id === blockId ? { ...block, ...patch, updated_at: nowIso() } : block,
    ),
    video: { ...bundle.video, updated_at: nowIso() },
  }));
}

export function updateLocalStage(stageId: string, patch: Partial<StageRow>) {
  updateLocalWeek((bundle) => ({
    ...bundle,
    stages: bundle.stages.map((stage) =>
      stage.id === stageId ? { ...stage, ...patch, updated_at: nowIso() } : stage,
    ),
    video: { ...bundle.video, updated_at: nowIso() },
  }));
}

export function rebalanceLocalWeek() {
  updateLocalWeek((bundle) => rebalanceLocalBundle(bundle));
}

export function saveLocalSetup(title: string, plannedBlocks: Record<string, number>) {
  updateLocalWeek((bundle) =>
    rebalanceLocalBundle({
      ...bundle,
      video: { ...bundle.video, title: title.trim() || "Untitled video", updated_at: nowIso() },
      stages: bundle.stages.map((stage) => ({
        ...stage,
        planned_blocks: plannedBlocks[stage.id] ?? stage.planned_blocks,
        updated_at: nowIso(),
      })),
    }),
  );
}

export function createNextLocalWeek() {
  const nextMonday = addDays(getMondayOf(new Date()), 7);
  const bundle = createLocalWeekFor(nextMonday);
  saveBundle(bundle);
  return bundle.videoId;
}
