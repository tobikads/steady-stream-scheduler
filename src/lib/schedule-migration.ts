import type { WorkBlockRow, WorkBlockStatus } from "@/lib/db-types";
import { blockWorkCapacityMinutes, isRecoveryBlock } from "@/lib/catch-up";
import {
  STAGE_BLOCK_MINUTES,
  WEEK_TEMPLATE,
  buildBlockTimestamps,
  type Slot,
} from "@/lib/schedule";

export interface TemplateBlockFields {
  day_of_week: number;
  slot: Slot;
  scheduled_start: string;
  scheduled_end: string;
  assigned_stage_id: string | null;
  assigned_portion: number;
  clock_in_at: string | null;
  clock_out_at: string | null;
  actual_minutes: number;
  status: WorkBlockStatus;
  notes: string | null;
  is_catch_up: boolean;
  planned_break_minutes: number;
  pause_count: number;
  pause_minutes: number;
  task_snapshot: WorkBlockRow["task_snapshot"];
}

function sameInstant(left: string, right: Date) {
  return Math.abs(new Date(left).getTime() - right.getTime()) < 1000;
}

function portionFor(start: string, end: string) {
  const minutes = Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
  return Math.round((minutes / STAGE_BLOCK_MINUTES) * 10000) / 10000;
}

function regularBlocks(blocks: WorkBlockRow[]) {
  return blocks.filter((block) => !isRecoveryBlock(block));
}

export function detailedScheduleMatches(monday: Date, blocks: WorkBlockRow[]) {
  const regular = regularBlocks(blocks);
  if (regular.length !== WEEK_TEMPLATE.length) return false;

  return WEEK_TEMPLATE.every((template) => {
    const { start, end } = buildBlockTimestamps(monday, template);
    return regular.some(
      (block) =>
        block.day_of_week === template.day_of_week &&
        block.slot === template.slot &&
        sameInstant(block.scheduled_start, start) &&
        sameInstant(block.scheduled_end, end),
    );
  });
}

function migratedMinutesFor(block: WorkBlockRow) {
  const actual = Math.max(0, Number(block.actual_minutes || 0));
  if (actual > 0) return actual;
  if (block.status === "done") return Math.round(blockWorkCapacityMinutes(block));
  return 0;
}

function candidateRowsFor(oldBlock: WorkBlockRow, rows: TemplateBlockFields[]) {
  const oldStart = new Date(oldBlock.scheduled_start).getTime();
  return rows
    .filter(
      (row) =>
        row.day_of_week === oldBlock.day_of_week &&
        row.status === "upcoming" &&
        new Date(row.scheduled_start).getTime() >= oldStart,
    )
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
}

export function buildDetailedScheduleFields(
  monday: Date,
  oldBlocks: WorkBlockRow[],
): TemplateBlockFields[] {
  const rows = WEEK_TEMPLATE.map((template) => {
    const { start, end } = buildBlockTimestamps(monday, template);
    const scheduledStart = start.toISOString();
    const scheduledEnd = end.toISOString();
    return {
      day_of_week: template.day_of_week,
      slot: template.slot,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      assigned_stage_id: null,
      assigned_portion: portionFor(scheduledStart, scheduledEnd),
      clock_in_at: null,
      clock_out_at: null,
      actual_minutes: 0,
      status: "upcoming" as const,
      notes: null,
      is_catch_up: false,
      planned_break_minutes: template.breakAfterMinutes,
      pause_count: 0,
      pause_minutes: 0,
      task_snapshot: null,
    };
  });

  const closedOrLogged = [...oldBlocks]
    .filter((block) => !isRecoveryBlock(block) && migratedMinutesFor(block) > 0)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  for (const oldBlock of closedOrLogged) {
    let remaining = migratedMinutesFor(oldBlock);
    const touched: TemplateBlockFields[] = [];

    for (const row of candidateRowsFor(oldBlock, rows)) {
      if (remaining <= 0) break;
      const rowMinutes = Math.max(
        1,
        Math.round(
          (new Date(row.scheduled_end).getTime() - new Date(row.scheduled_start).getTime()) / 60000,
        ),
      );
      const used = Math.min(remaining, rowMinutes);
      row.status = used >= rowMinutes ? "done" : "partial";
      row.actual_minutes = used;
      row.assigned_stage_id = oldBlock.assigned_stage_id;
      row.clock_in_at = oldBlock.clock_in_at;
      row.clock_out_at = oldBlock.clock_out_at;
      touched.push(row);
      remaining -= used;
    }

    const detailTarget = touched.at(-1);
    if (detailTarget) {
      detailTarget.notes = oldBlock.notes;
      detailTarget.pause_count = Number(oldBlock.pause_count || 0);
      detailTarget.pause_minutes = Number(oldBlock.pause_minutes || 0);
      detailTarget.task_snapshot = oldBlock.task_snapshot ?? null;
    }
  }

  return rows;
}
