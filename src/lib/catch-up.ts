import type { StageRow, VideoRow, WorkBlockRow } from "@/lib/db-types";
import { DAY_LABELS, STAGE_LABEL, addDays, isClosedBlockStatus } from "@/lib/schedule";

export const DEFAULT_BREAK_MINUTES = 15;
export const SHORT_BREAK_MINUTES = 10;
export const DEFAULT_BLOCK_MINUTES = 210;
export const MIN_CATCH_UP_MINUTES = 30;
export const MAX_CATCH_UP_MINUTES = 120;

export type CatchUpAction =
  | {
      id: string;
      type: "extra_block";
      day_of_week: number;
      slot: "EVE";
      scheduled_start: string;
      scheduled_end: string;
      minutes: number;
      stageId: string | null;
      stageLabel: string;
    }
  | {
      id: string;
      type: "short_break";
      blockId: string;
      day_of_week: number;
      slot: WorkBlockRow["slot"];
      scheduled_start: string;
      minutes: number;
      fromBreakMinutes: number;
      toBreakMinutes: number;
      stageLabel: string;
    };

export interface CatchUpPlan {
  state: "on_track" | "recoverable" | "impossible";
  overallPct: number;
  workLeftMinutes: number;
  futureScheduledMinutes: number;
  missedOrShortMinutes: number;
  deficitMinutes: number;
  targetRecoveryMinutes: number;
  recoveryMinutes: number;
  remainingGapMinutes: number;
  actions: CatchUpAction[];
}

function localDateFromISODate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function endOfReleaseDay(value: string) {
  const end = localDateFromISODate(value);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function blockDurationMinutes(
  block: Pick<WorkBlockRow, "scheduled_start" | "scheduled_end">,
) {
  const start = new Date(block.scheduled_start).getTime();
  const end = new Date(block.scheduled_end).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

export function plannedBreakMinutes(block: Pick<WorkBlockRow, "planned_break_minutes">) {
  return typeof block.planned_break_minutes === "number" && block.planned_break_minutes > 0
    ? block.planned_break_minutes
    : DEFAULT_BREAK_MINUTES;
}

export function formatCatchUpMinutes(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function isFutureAvailable(block: WorkBlockRow, now: Date) {
  return (
    !isClosedBlockStatus(block.status) && new Date(block.scheduled_start).getTime() > now.getTime()
  );
}

function stageLabelFor(stages: StageRow[], stageId: string | null) {
  const stage = stages.find((item) => item.id === stageId);
  return stage ? STAGE_LABEL[stage.kind] : "Video work";
}

function stageQueue(stages: StageRow[], blocks: WorkBlockRow[]) {
  const futureAssigned = new Map<string, number>();
  for (const block of blocks) {
    if (!isClosedBlockStatus(block.status) && !block.is_catch_up && block.assigned_stage_id) {
      futureAssigned.set(
        block.assigned_stage_id,
        (futureAssigned.get(block.assigned_stage_id) ?? 0) + Number(block.assigned_portion || 1),
      );
    }
  }

  return [...stages]
    .sort((a, b) => a.order_index - b.order_index)
    .flatMap((stage) => {
      const planned = Number(stage.planned_blocks);
      const actual = Number(stage.actual_blocks);
      const alreadyScheduled = futureAssigned.get(stage.id) ?? 0;
      const missing = Math.max(0, planned - actual - alreadyScheduled);
      return Array.from({ length: Math.ceil(missing) }, () => stage);
    });
}

function missedOrShortMinutes(blocks: WorkBlockRow[]) {
  return blocks.reduce((sum, block) => {
    const expected = blockDurationMinutes(block) * Number(block.assigned_portion || 1);
    if (block.status === "missed" || block.status === "skipped") return sum + expected;
    if (block.status === "partial")
      return sum + Math.max(0, expected - Number(block.actual_minutes || 0));
    return sum;
  }, 0);
}

function roundUpToNextFiveMinutes(date: Date) {
  const next = new Date(date);
  next.setSeconds(0, 0);
  const remainder = next.getMinutes() % 5;
  if (remainder > 0) next.setMinutes(next.getMinutes() + (5 - remainder));
  return next;
}

function usableWindow(day: number, start: Date, end: Date, blocks: WorkBlockRow[], now: Date) {
  const adjustedStart =
    now.getTime() > start.getTime() && now.getTime() < end.getTime()
      ? roundUpToNextFiveMinutes(now)
      : start;
  const minutes = Math.round((end.getTime() - adjustedStart.getTime()) / 60000);
  const overlapsExistingCatchUp = blocks.some((block) => {
    if (!block.is_catch_up || block.day_of_week !== day) return false;
    const blockStart = new Date(block.scheduled_start).getTime();
    const blockEnd = new Date(block.scheduled_end).getTime();
    return blockStart < end.getTime() && blockEnd > adjustedStart.getTime();
  });

  if (
    overlapsExistingCatchUp ||
    adjustedStart.getTime() <= now.getTime() ||
    minutes < MIN_CATCH_UP_MINUTES
  ) {
    return null;
  }

  return { day, start: adjustedStart, end };
}

function availableExtraWindows(video: VideoRow, blocks: WorkBlockRow[], now: Date) {
  const monday = localDateFromISODate(video.week_start);
  const releaseEnd = endOfReleaseDay(video.release_date);
  const windows = [
    ...[1, 3].map((day) => ({ day, startHour: 20, startMinute: 0, endHour: 23, endMinute: 30 })),
    ...[2, 4, 5, 6].map((day) => ({
      day,
      startHour: 18,
      startMinute: 0,
      endHour: 20,
      endMinute: 0,
    })),
  ];

  return windows
    .map(({ day, startHour, startMinute, endHour, endMinute }) => {
      const start = addDays(monday, day - 1);
      start.setHours(startHour, startMinute, 0, 0);
      const end = addDays(monday, day - 1);
      end.setHours(endHour, endMinute, 0, 0);
      return usableWindow(day, start, end, blocks, now);
    })
    .filter((window): window is { day: number; start: Date; end: Date } =>
      Boolean(window && window.end.getTime() <= releaseEnd.getTime()),
    );
}

export function buildCatchUpPlan(
  video: VideoRow,
  stages: StageRow[],
  blocks: WorkBlockRow[],
  now = new Date(),
): CatchUpPlan {
  const totalPlannedBlocks = stages.reduce((sum, stage) => sum + Number(stage.planned_blocks), 0);
  const totalActualBlocks = stages.reduce(
    (sum, stage) => sum + Math.min(Number(stage.actual_blocks), Number(stage.planned_blocks)),
    0,
  );
  const overallPct =
    totalPlannedBlocks > 0 ? Math.min(100, (totalActualBlocks / totalPlannedBlocks) * 100) : 0;
  const workLeftMinutes = Math.max(
    0,
    (totalPlannedBlocks - totalActualBlocks) * DEFAULT_BLOCK_MINUTES,
  );
  const futureBlocks = blocks.filter((block) => isFutureAvailable(block, now));
  const alreadyAppliedBreakGain = futureBlocks.reduce(
    (sum, block) => sum + Math.max(0, DEFAULT_BREAK_MINUTES - plannedBreakMinutes(block)),
    0,
  );
  const futureScheduledMinutes =
    futureBlocks.reduce((sum, block) => sum + blockDurationMinutes(block), 0) +
    alreadyAppliedBreakGain;
  const deficitMinutes = Math.max(0, Math.round(workLeftMinutes - futureScheduledMinutes));
  const targetRecoveryMinutes =
    deficitMinutes === 0
      ? 0
      : Math.min(MAX_CATCH_UP_MINUTES, Math.max(MIN_CATCH_UP_MINUTES, deficitMinutes));
  const actions: CatchUpAction[] = [];
  const queue = stageQueue(stages, blocks);
  let remaining = targetRecoveryMinutes;
  let stageIndex = 0;

  for (const window of availableExtraWindows(video, blocks, now)) {
    if (remaining <= 0) break;
    const minutes = Math.min(
      remaining,
      Math.round((window.end.getTime() - window.start.getTime()) / 60000),
    );
    const stage = queue[stageIndex++] ?? null;
    actions.push({
      id: `extra-${window.day}`,
      type: "extra_block",
      day_of_week: window.day,
      slot: "EVE",
      scheduled_start: window.start.toISOString(),
      scheduled_end: new Date(window.start.getTime() + minutes * 60000).toISOString(),
      minutes,
      stageId: stage?.id ?? null,
      stageLabel: stage ? STAGE_LABEL[stage.kind] : "Video work",
    });
    remaining -= minutes;
  }

  const restCutBlocks = futureBlocks
    .filter(
      (block) =>
        !block.is_catch_up &&
        [2, 4, 5, 6].includes(block.day_of_week) &&
        plannedBreakMinutes(block) > SHORT_BREAK_MINUTES,
    )
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  const restCutActions: CatchUpAction[] = [];
  for (const block of restCutBlocks) {
    if (remaining <= 0) break;
    const currentBreak = plannedBreakMinutes(block);
    const minutes = Math.min(remaining, currentBreak - SHORT_BREAK_MINUTES);
    restCutActions.push({
      id: `rest-${block.id}`,
      type: "short_break",
      blockId: block.id,
      day_of_week: block.day_of_week,
      slot: block.slot,
      scheduled_start: block.scheduled_start,
      minutes,
      fromBreakMinutes: currentBreak,
      toBreakMinutes: SHORT_BREAK_MINUTES,
      stageLabel: stageLabelFor(stages, block.assigned_stage_id),
    });
    remaining -= minutes;
  }
  const restCutMinutes = restCutActions.reduce((sum, action) => sum + action.minutes, 0);
  if (restCutMinutes >= MIN_CATCH_UP_MINUTES) {
    actions.push(...restCutActions);
  } else {
    remaining += restCutMinutes;
  }

  const recoveryMinutes = actions.reduce((sum, action) => sum + action.minutes, 0);
  const remainingGapMinutes = Math.max(0, deficitMinutes - recoveryMinutes);
  return {
    state:
      deficitMinutes === 0 ? "on_track" : remainingGapMinutes === 0 ? "recoverable" : "impossible",
    overallPct,
    workLeftMinutes: Math.round(workLeftMinutes),
    futureScheduledMinutes: Math.round(futureScheduledMinutes),
    missedOrShortMinutes: Math.round(missedOrShortMinutes(blocks)),
    deficitMinutes,
    targetRecoveryMinutes,
    recoveryMinutes,
    remainingGapMinutes,
    actions,
  };
}

export function dayLabel(day: number) {
  return DAY_LABELS[day - 1] ?? `Day ${day}`;
}
