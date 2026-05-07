import type { Tables } from "@/integrations/supabase/types";
import type { Slot, StageKind } from "@/lib/schedule";

export type VideoRow = Tables<"videos">;
export type StageRow = Omit<Tables<"stages">, "kind"> & { kind: StageKind };
export type WorkBlockStatus =
  | "upcoming"
  | "in_progress"
  | "done"
  | "partial"
  | "missed"
  | "skipped";
export type WorkBlockRow = Omit<Tables<"work_blocks">, "slot" | "status"> & {
  slot: Slot;
  status: WorkBlockStatus;
};

export function getErrorMessage(error: unknown, fallback = "Something went wrong") {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
