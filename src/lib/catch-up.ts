import type { StageRow, VideoRow, WorkBlockRow } from "@/lib/db-types";
import {
  DAY_LABELS,
  FOCUS_SESSION_MINUTES,
  STAGE_LABEL,
  STAGE_BLOCK_MINUTES,
  addDays,
  isClosedBlockStatus,
} from "@/lib/schedule";

export const DEFAULT_BREAK_MINUTES = 15;
export const SHORT_BREAK_MINUTES = 10;
export const DEFAULT_BLOCK_MINUTES = STAGE_BLOCK_MINUTES;
export const MIN_CATCH_UP_MINUTES = 30;
export const MAX_CATCH_UP_MINUTES = 120;
const CATCH_UP_CHUNKS = [120, 90, 60, 30] as const;
const CATCH_UP_CHUNKS_ASC = [...CATCH_UP_CHUNKS].reverse();
const MAX_RECOVERY_PROBE_MINUTES = 7 * 24 * 60;

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
      scheduled_end: string;
      recovery_start: string;
      recovery_end: string;
      minutes: number;
      fromBreakMinutes: number;
      toBreakMinutes: number;
      stageId: string | null;
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
  recoveryCapacityMinutes: number;
  recoveryMinutes: number;
  remainingGapMinutes: number;
  missBudgetMinutes: number;
  maxMissableFullBlocks: number;
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

function minutesSinceMidnight(value: string) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

export function isRecoveryBlock(
  block: Pick<
    WorkBlockRow,
    "is_catch_up" | "day_of_week" | "slot" | "scheduled_start" | "scheduled_end"
  >,
) {
  if (block.is_catch_up) return true;
  if (block.slot === "REC") return true;
  if (block.slot !== "EVE") return false;

  const start = minutesSinceMidnight(block.scheduled_start);
  const end = minutesSinceMidnight(block.scheduled_end);
  if (end <= start) return false;

  const mondayOrWednesdayWindow =
    [1, 3].includes(block.day_of_week) && start >= 18 * 60 && end <= 22 * 60;
  const eveningGapWindow =
    [2, 4, 5, 6].includes(block.day_of_week) && start >= 18 * 60 && end <= 20 * 60;
  return mondayOrWednesdayWindow || eveningGapWindow;
}

export function blockDisplayTitle(block: WorkBlockRow, stage: StageRow | null | undefined) {
  if (isRecoveryBlock(block)) return "Recovery time";
  return stage ? STAGE_LABEL[stage.kind] : "Unassigned";
}

export function recoveryStageDetail(block: WorkBlockRow, stage: StageRow | null | undefined) {
  if (!isRecoveryBlock(block) || !stage) return null;
  return `Makes up ${STAGE_LABEL[stage.kind]}`;
}

export function blockWorkCapacityMinutes(
  block: Pick<
    WorkBlockRow,
    | "scheduled_start"
    | "scheduled_end"
    | "assigned_portion"
    | "is_catch_up"
    | "day_of_week"
    | "slot"
  >,
) {
  if (isRecoveryBlock(block)) return blockDurationMinutes(block);
  return Math.min(
    blockDurationMinutes(block),
    DEFAULT_BLOCK_MINUTES * Number(block.assigned_portion || 1),
  );
}

export function plannedBreakMinutes(block: Pick<WorkBlockRow, "planned_break_minutes">) {
  return typeof block.planned_break_minutes === "number" && block.planned_break_minutes >= 0
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
  const futureAssignedMinutes = new Map<string, number>();
  for (const block of blocks) {
    if (!isClosedBlockStatus(block.status) && block.assigned_stage_id) {
      futureAssignedMinutes.set(
        block.assigned_stage_id,
        (futureAssignedMinutes.get(block.assigned_stage_id) ?? 0) + blockWorkCapacityMinutes(block),
      );
    }
  }

  return [...stages]
    .sort((a, b) => a.order_index - b.order_index)
    .map((stage) => {
      const plannedMinutes = Number(stage.planned_blocks) * DEFAULT_BLOCK_MINUTES;
      const actualMinutes =
        Math.min(Number(stage.actual_blocks), Number(stage.planned_blocks)) * DEFAULT_BLOCK_MINUTES;
      const alreadyScheduledMinutes = futureAssignedMinutes.get(stage.id) ?? 0;
      return {
        stage,
        remainingMinutes: Math.max(
          0,
          Math.round(plannedMinutes - actualMinutes - alreadyScheduledMinutes),
        ),
      };
    })
    .filter((stageNeed) => stageNeed.remainingMinutes > 0);
}

function missedOrShortMinutes(blocks: WorkBlockRow[]) {
  return blocks.reduce((sum, block) => {
    const expected = blockWorkCapacityMinutes(block);
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
  const overlapsExistingWork = blocks.some((block) => {
    if (block.day_of_week !== day || isClosedBlockStatus(block.status)) return false;
    const blockStart = new Date(block.scheduled_start).getTime();
    const blockEnd = new Date(block.scheduled_end).getTime();
    return blockStart < end.getTime() && blockEnd > adjustedStart.getTime();
  });

  if (
    overlapsExistingWork ||
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
    ...[1, 3].flatMap((day) => [
      { day, startHour: 18, startMinute: 0, endHour: 20, endMinute: 0 },
      { day, startHour: 20, startMinute: 0, endHour: 22, endMinute: 0 },
    ]),
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
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

function recoveryTargetMinutes(deficitMinutes: number) {
  if (deficitMinutes <= 0) return 0;
  return Math.max(MIN_CATCH_UP_MINUTES, deficitMinutes);
}

function nextCatchUpChunk(remaining: number, capacity: number) {
  return (
    CATCH_UP_CHUNKS_ASC.find((chunk) => chunk <= capacity && chunk >= remaining) ??
    CATCH_UP_CHUNKS.find((chunk) => chunk <= capacity && chunk <= remaining) ??
    null
  );
}

function sumActionMinutes(actions: CatchUpAction[]) {
  return actions.reduce((sum, action) => sum + action.minutes, 0);
}

function buildRecoveryActions(
  video: VideoRow,
  stages: StageRow[],
  blocks: WorkBlockRow[],
  now: Date,
  targetRecoveryMinutes: number,
) {
  const actions: CatchUpAction[] = [];
  const queue = stageQueue(stages, blocks);
  let remaining = targetRecoveryMinutes;
  let stageIndex = 0;

  for (const window of availableExtraWindows(video, blocks, now)) {
    if (remaining <= 0) break;

    let cursor = new Date(window.start);
    let capacity = Math.round((window.end.getTime() - cursor.getTime()) / 60000);

    while (remaining > 0 && capacity >= MIN_CATCH_UP_MINUTES) {
      const stageNeed = queue[stageIndex] ?? null;
      const stageCapacity = stageNeed
        ? Math.max(MIN_CATCH_UP_MINUTES, stageNeed.remainingMinutes)
        : remaining;
      const minutes =
        nextCatchUpChunk(Math.min(remaining, stageCapacity), capacity) ??
        nextCatchUpChunk(remaining, capacity);
      if (!minutes) break;

      const stage = stageNeed?.stage ?? null;
      const start = new Date(cursor);
      const end = new Date(start.getTime() + minutes * 60000);
      actions.push({
        id: `extra-${window.day}-${start.getTime()}`,
        type: "extra_block",
        day_of_week: window.day,
        slot: "EVE",
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        minutes,
        stageId: stage?.id ?? null,
        stageLabel: stage ? STAGE_LABEL[stage.kind] : "Video work",
      });

      if (stageNeed) {
        stageNeed.remainingMinutes -= minutes;
        while (stageIndex < queue.length && queue[stageIndex].remainingMinutes <= 0) {
          stageIndex += 1;
        }
      }
      remaining -= minutes;
      cursor = end;
      capacity = Math.round((window.end.getTime() - cursor.getTime()) / 60000);
    }
  }

  const futureBlocks = blocks.filter((block) => isFutureAvailable(block, now));
  const restCutBlocks = futureBlocks
    .filter(
      (block) =>
        !isRecoveryBlock(block) &&
        [1, 2, 3, 4, 5, 6].includes(block.day_of_week) &&
        plannedBreakMinutes(block) > SHORT_BREAK_MINUTES,
    )
    .sort((a, b) => {
      const aRoom = plannedBreakMinutes(a) - SHORT_BREAK_MINUTES;
      const bRoom = plannedBreakMinutes(b) - SHORT_BREAK_MINUTES;
      if (bRoom !== aRoom) return bRoom - aRoom;
      return a.scheduled_start.localeCompare(b.scheduled_start);
    });

  const restCutActions: CatchUpAction[] = [];
  for (const block of restCutBlocks) {
    if (remaining <= 0) break;
    const currentBreak = plannedBreakMinutes(block);
    const availableMinutes = currentBreak - SHORT_BREAK_MINUTES;
    const alreadyBundledRecovery = sumActionMinutes(restCutActions);
    if (availableMinutes < MIN_CATCH_UP_MINUTES && alreadyBundledRecovery === 0) continue;

    const stageNeed = queue[stageIndex] ?? null;
    const stageCapacity = stageNeed
      ? Math.max(MIN_CATCH_UP_MINUTES, stageNeed.remainingMinutes)
      : remaining;
    const minutes = Math.min(remaining, stageCapacity, availableMinutes);
    if (minutes <= 0) continue;

    const recoveryStart = new Date(
      new Date(block.scheduled_end).getTime() + SHORT_BREAK_MINUTES * 60000,
    );
    const recoveryEnd = new Date(recoveryStart.getTime() + minutes * 60000);
    const stage = stageNeed?.stage ?? null;
    restCutActions.push({
      id: `rest-${block.id}`,
      type: "short_break",
      blockId: block.id,
      day_of_week: block.day_of_week,
      slot: block.slot,
      scheduled_start: block.scheduled_start,
      scheduled_end: block.scheduled_end,
      recovery_start: recoveryStart.toISOString(),
      recovery_end: recoveryEnd.toISOString(),
      minutes,
      fromBreakMinutes: currentBreak,
      toBreakMinutes: SHORT_BREAK_MINUTES,
      stageId: stage?.id ?? null,
      stageLabel: stage ? STAGE_LABEL[stage.kind] : stageLabelFor(stages, block.assigned_stage_id),
    });
    if (stageNeed) {
      stageNeed.remainingMinutes -= minutes;
      while (stageIndex < queue.length && queue[stageIndex].remainingMinutes <= 0) {
        stageIndex += 1;
      }
    }
    remaining -= minutes;
  }

  if (sumActionMinutes(restCutActions) >= MIN_CATCH_UP_MINUTES) {
    actions.push(...restCutActions);
  }

  return actions;
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
    futureBlocks.reduce((sum, block) => sum + blockWorkCapacityMinutes(block), 0) +
    alreadyAppliedBreakGain;
  const deficitMinutes = Math.max(0, Math.round(workLeftMinutes - futureScheduledMinutes));
  const targetRecoveryMinutes = recoveryTargetMinutes(deficitMinutes);
  const actions = buildRecoveryActions(video, stages, blocks, now, targetRecoveryMinutes);
  const recoveryCapacityMinutes = sumActionMinutes(
    buildRecoveryActions(video, stages, blocks, now, MAX_RECOVERY_PROBE_MINUTES),
  );
  const missBudgetMinutes = Math.max(
    0,
    Math.round(futureScheduledMinutes + recoveryCapacityMinutes - workLeftMinutes),
  );
  const recoveryMinutes = sumActionMinutes(actions);
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
    recoveryCapacityMinutes,
    recoveryMinutes,
    remainingGapMinutes,
    missBudgetMinutes,
    maxMissableFullBlocks: Math.floor(missBudgetMinutes / FOCUS_SESSION_MINUTES),
    actions,
  };
}

export function dayLabel(day: number) {
  return DAY_LABELS[day - 1] ?? `Day ${day}`;
}
