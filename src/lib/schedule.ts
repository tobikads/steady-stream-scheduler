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

export type Slot = "AM" | "PM" | "EVE";

export interface BlockTemplate {
  day_of_week: number; // 1=Mon..6=Sat
  slot: Slot;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

// Mon, Wed: AM+PM. Tue, Thu, Fri, Sat: AM+PM+EVE. 16 blocks total.
export const WEEK_TEMPLATE: BlockTemplate[] = (() => {
  const out: BlockTemplate[] = [];
  for (let d = 1; d <= 6; d++) {
    out.push({
      day_of_week: d,
      slot: "AM",
      startHour: 9,
      startMinute: 0,
      endHour: 12,
      endMinute: 30,
    });
    out.push({
      day_of_week: d,
      slot: "PM",
      startHour: 14,
      startMinute: 30,
      endHour: 18,
      endMinute: 0,
    });
    if (d === 2 || d === 4 || d === 5 || d === 6) {
      out.push({
        day_of_week: d,
        slot: "EVE",
        startHour: 20,
        startMinute: 0,
        endHour: 23,
        endMinute: 30,
      });
    }
  }
  return out;
})();

export const TOTAL_WEEKLY_BLOCKS = WEEK_TEMPLATE.length; // 16

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

/**
 * Computes new stage assignments for upcoming blocks.
 * - Closed blocks keep their existing assignment.
 * - Remaining work for each stage = max(0, planned - actual) using stage order.
 * - Each upcoming block gets one stage (portion=1) in order; final block of a stage may have <1.
 *   For UI simplicity we assign whole blocks per stage and ignore fractional remainder
 *   (rounded up so we don't underplan).
 */
export function rebalance(stages: StageInput[], blocks: BlockInput[]): RebalanceAssignment[] {
  const ordered = [...stages].sort((a, b) => a.order_index - b.order_index);
  const missed = missedPortionsByStage(blocks);
  // Missed blocks should not be completed, but they should consume their original place
  // on the timeline so Thursday does not slide back to Monday's work.
  const remaining = new Map<string, number>();
  for (const s of ordered) {
    const left = Math.max(0, s.planned_blocks - s.actual_blocks - (missed.get(s.id) ?? 0));
    remaining.set(s.id, Math.ceil(left));
  }

  const upcoming = blocks
    .filter((b) => !isClosedBlockStatus(b.status) && !b.is_catch_up)
    .sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));

  const assignments: RebalanceAssignment[] = [];
  let stageIdx = 0;

  for (const block of upcoming) {
    while (stageIdx < ordered.length && (remaining.get(ordered[stageIdx].id) ?? 0) <= 0) {
      stageIdx++;
    }
    if (stageIdx >= ordered.length) {
      assignments.push({ blockId: block.id, stageId: null, portion: 1 });
      continue;
    }
    const stage = ordered[stageIdx];
    assignments.push({ blockId: block.id, stageId: stage.id, portion: 1 });
    remaining.set(stage.id, (remaining.get(stage.id) ?? 0) - 1);
  }

  return assignments;
}

export function totalRemainingBlocks(stages: StageInput[]): number {
  return stages.reduce((sum, s) => sum + Math.max(0, s.planned_blocks - s.actual_blocks), 0);
}

export function upcomingBlockCount(blocks: BlockInput[]): number {
  return blocks.filter((b) => !isClosedBlockStatus(b.status)).length;
}

export function deliveryStatus(
  stages: StageInput[],
  blocks: BlockInput[],
): {
  state: "ahead" | "ontrack" | "behind" | "atrisk";
  diffBlocks: number; // negative = behind, positive = ahead
} {
  const remaining = totalRemainingBlocks(stages);
  const upcoming = upcomingBlockCount(blocks);
  const diff = upcoming - remaining;
  if (remaining > upcoming) return { state: "atrisk", diffBlocks: diff };
  if (diff >= 2) return { state: "ahead", diffBlocks: diff };
  if (diff === 0 || diff === 1) return { state: "ontrack", diffBlocks: diff };
  return { state: "behind", diffBlocks: diff };
}
