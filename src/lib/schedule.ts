// Pure scheduling logic: stage defaults, week template, rebalancer.
// No I/O. Tested by being deterministic.

export type StageKind =
  | "research"
  | "scripting"
  | "recording"
  | "cleanup"
  | "layout"
  | "editing"
  | "finishing";

export const STAGE_ORDER: StageKind[] = [
  "research",
  "scripting",
  "recording",
  "cleanup",
  "layout",
  "editing",
  "finishing",
];

export const STAGE_LABEL: Record<StageKind, string> = {
  research: "Research",
  scripting: "Scripting",
  recording: "Recording",
  cleanup: "Cleaning up video",
  layout: "Laying out clips",
  editing: "Editing",
  finishing: "Finishing touches",
};

export const STAGE_DEFAULTS: Record<StageKind, { default: number; min: number; max: number }> = {
  research: { default: 2, min: 1, max: 3 },
  scripting: { default: 3, min: 2, max: 5 },
  recording: { default: 1.5, min: 0.5, max: 2 },
  cleanup: { default: 2, min: 1, max: 4 },
  layout: { default: 3, min: 2, max: 4 },
  editing: { default: 3, min: 2, max: 4 },
  finishing: { default: 1, min: 1, max: 3 },
};

export type Slot = "AM" | "PM" | "EVE" | "REC" | `S${number}`;

export const FOCUS_SESSION_MINUTES = 60;
export const STAGE_BLOCK_MINUTES = 3 * FOCUS_SESSION_MINUTES;
export const SCHEDULE_BREAK_MINUTES = 15;
export const SCHEDULE_LONG_BREAK_MINUTES = 60;
export const SCHEDULE_DAY_START_MINUTES = 9 * 60;
export const SCHEDULE_DAY_END_MINUTES = 21 * 60;

export interface BlockTemplate {
  day_of_week: number; // 1=Mon..6=Sat
  slot: Slot;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  breakAfterMinutes: number;
}

function splitMinutes(minutes: number) {
  return {
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
  };
}

const DAILY_FOCUS_TEMPLATE = [
  { start: 9 * 60, end: 10 * 60, breakAfterMinutes: SCHEDULE_BREAK_MINUTES },
  { start: 10 * 60 + 15, end: 11 * 60 + 15, breakAfterMinutes: SCHEDULE_LONG_BREAK_MINUTES },
  { start: 12 * 60 + 15, end: 13 * 60 + 15, breakAfterMinutes: SCHEDULE_BREAK_MINUTES },
  { start: 13 * 60 + 30, end: 14 * 60 + 30, breakAfterMinutes: SCHEDULE_LONG_BREAK_MINUTES },
  { start: 15 * 60 + 30, end: 16 * 60 + 30, breakAfterMinutes: SCHEDULE_BREAK_MINUTES },
  { start: 16 * 60 + 45, end: 17 * 60 + 45, breakAfterMinutes: SCHEDULE_LONG_BREAK_MINUTES },
  { start: 18 * 60 + 45, end: 19 * 60 + 45, breakAfterMinutes: SCHEDULE_BREAK_MINUTES },
  { start: 20 * 60, end: 21 * 60, breakAfterMinutes: 0 },
] as const;

// Detailed focus-cycle day: 8 hours of work, 1 hour of short breaks, 3 hours of long breaks.
export const WEEK_TEMPLATE: BlockTemplate[] = (() => {
  const out: BlockTemplate[] = [];
  for (let d = 1; d <= 6; d++) {
    DAILY_FOCUS_TEMPLATE.forEach((sessionTemplate, index) => {
      const startParts = splitMinutes(sessionTemplate.start);
      const endParts = splitMinutes(sessionTemplate.end);
      out.push({
        day_of_week: d,
        slot: `S${index + 1}`,
        startHour: startParts.hour,
        startMinute: startParts.minute,
        endHour: endParts.hour,
        endMinute: endParts.minute,
        breakAfterMinutes: sessionTemplate.breakAfterMinutes,
      });
    });
  }
  return out;
})();

export const TOTAL_WEEKLY_BLOCKS = WEEK_TEMPLATE.length;

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function slotLabel(slot: Slot | string): string {
  if (/^S\d+$/.test(slot)) return `Work ${slot.slice(1)}`;
  if (slot === "AM") return "AM";
  if (slot === "PM") return "PM";
  if (slot === "EVE") return "EVE";
  if (slot === "REC") return "Recovery";
  return slot;
}

export function getMondayOf(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dateToISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildBlockTimestamps(
  weekStart: Date,
  tpl: BlockTemplate,
): { start: Date; end: Date } {
  const start = addDays(weekStart, tpl.day_of_week - 1);
  start.setHours(tpl.startHour, tpl.startMinute, 0, 0);
  const end = addDays(weekStart, tpl.day_of_week - 1);
  end.setHours(tpl.endHour, tpl.endMinute, 0, 0);
  return { start, end };
}

export interface StageInput {
  id: string;
  kind: StageKind;
  order_index: number;
  planned_blocks: number;
  actual_blocks: number;
  percent_complete: number;
  completed: boolean;
}

export interface BlockInput {
  id: string;
  day_of_week: number;
  slot: Slot;
  scheduled_start: string;
  scheduled_end: string;
  assigned_stage_id: string | null;
  assigned_portion: number;
  status: string;
  is_catch_up?: boolean;
}

export interface RebalanceAssignment {
  blockId: string;
  stageId: string | null;
  portion: number;
}

export function isClosedBlockStatus(status: string): boolean {
  return status === "done" || status === "partial" || status === "missed" || status === "skipped";
}

function missedPortionsByStage(blocks: BlockInput[]) {
  const missed = new Map<string, number>();
  for (const block of blocks) {
    if ((block.status === "missed" || block.status === "skipped") && block.assigned_stage_id) {
      missed.set(
        block.assigned_stage_id,
        (missed.get(block.assigned_stage_id) ?? 0) + Number(block.assigned_portion || 1),
      );
    }
  }
  return missed;
}

function blockDurationMinutes(block: Pick<BlockInput, "scheduled_start" | "scheduled_end">) {
  const start = new Date(block.scheduled_start).getTime();
  const end = new Date(block.scheduled_end).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

function blockCapacityPortion(block: Pick<BlockInput, "scheduled_start" | "scheduled_end">) {
  return Math.max(
    0.01,
    Math.round((blockDurationMinutes(block) / STAGE_BLOCK_MINUTES) * 10000) / 10000,
  );
}

/**
 * Computes new stage assignments for upcoming blocks.
 * - Closed blocks keep their existing assignment.
 * - Remaining work for each stage = max(0, planned - actual) using stage order.
 * - Each upcoming focus session credits part of a stage block; final sessions can be fractional.
 */
export function rebalance(stages: StageInput[], blocks: BlockInput[]): RebalanceAssignment[] {
  const ordered = [...stages].sort((a, b) => a.order_index - b.order_index);
  const missed = missedPortionsByStage(blocks);
  // Missed blocks should not be completed, but they should consume their original place
  // on the timeline so Thursday does not slide back to Monday's work.
  const remaining = new Map<string, number>();
  for (const s of ordered) {
    const left = Math.max(0, s.planned_blocks - s.actual_blocks - (missed.get(s.id) ?? 0));
    remaining.set(s.id, left);
  }

  const upcoming = blocks
    .filter((b) => !isClosedBlockStatus(b.status) && !b.is_catch_up)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  const assignments: RebalanceAssignment[] = [];
  let stageIdx = 0;

  for (const block of upcoming) {
    while (stageIdx < ordered.length && (remaining.get(ordered[stageIdx].id) ?? 0) <= 0.0001) {
      stageIdx++;
    }
    const capacity = blockCapacityPortion(block);
    if (stageIdx >= ordered.length) {
      assignments.push({ blockId: block.id, stageId: null, portion: capacity });
      continue;
    }
    const stage = ordered[stageIdx];
    const portion = Math.min(capacity, remaining.get(stage.id) ?? capacity);
    assignments.push({ blockId: block.id, stageId: stage.id, portion });
    remaining.set(stage.id, (remaining.get(stage.id) ?? 0) - portion);
  }

  return assignments;
}

export function totalRemainingBlocks(stages: StageInput[]): number {
  return stages.reduce((sum, s) => sum + Math.max(0, s.planned_blocks - s.actual_blocks), 0);
}

export function upcomingBlockCount(blocks: BlockInput[]): number {
  return blocks.filter((b) => !isClosedBlockStatus(b.status)).length;
}

function upcomingStageBlockCapacity(blocks: BlockInput[]): number {
  return blocks
    .filter((b) => !isClosedBlockStatus(b.status))
    .reduce((sum, block) => sum + blockCapacityPortion(block), 0);
}

export function deliveryStatus(
  stages: StageInput[],
  blocks: BlockInput[],
): {
  state: "ahead" | "ontrack" | "behind" | "atrisk";
  diffBlocks: number; // negative = behind, positive = ahead
} {
  const remaining = totalRemainingBlocks(stages);
  const upcoming = upcomingStageBlockCapacity(blocks);
  const diff = upcoming - remaining;
  if (remaining > upcoming) return { state: "atrisk", diffBlocks: diff };
  if (diff >= 1) return { state: "ahead", diffBlocks: diff };
  if (diff >= 0) return { state: "ontrack", diffBlocks: diff };
  return { state: "behind", diffBlocks: diff };
}
