import { useEffect, useState } from "react";
import type { StageKind } from "@/lib/schedule";

export type PauseReasonId = "call" | "food" | "stuck" | "break" | "emergency";

export const PAUSE_REASONS: Array<{ id: PauseReasonId; label: string }> = [
  { id: "call", label: "Call" },
  { id: "food", label: "Food" },
  { id: "stuck", label: "Stuck" },
  { id: "break", label: "Break" },
  { id: "emergency", label: "Emergency" },
];

export const STAGE_CHECKLISTS: Record<StageKind, Array<{ id: string; label: string }>> = {
  research: [
    { id: "angle", label: "Lock the video angle" },
    { id: "sources", label: "Collect source links" },
    { id: "examples", label: "Pull examples and proof points" },
  ],
  scripting: [
    { id: "hook", label: "Write the opening hook" },
    { id: "outline", label: "Outline the sections" },
    { id: "draft", label: "Draft the full script" },
    { id: "read", label: "Read once for flow" },
  ],
  recording: [
    { id: "setup", label: "Set mic, camera, and scene" },
    { id: "a-roll", label: "Record A-roll" },
    { id: "retakes", label: "Capture retakes" },
  ],
  cleanup: [
    { id: "import", label: "Import footage" },
    { id: "sync", label: "Sync audio/video" },
    { id: "remove", label: "Remove bad takes and dead air" },
  ],
  layout: [
    { id: "timeline", label: "Lay out the core timeline" },
    { id: "b-roll", label: "Place B-roll and screenshots" },
    { id: "structure", label: "Check pacing and structure" },
  ],
  editing: [
    { id: "polish", label: "Polish cuts and zooms" },
    { id: "audio", label: "Level audio" },
    { id: "graphics", label: "Add text, graphics, and callouts" },
  ],
  finishing: [
    { id: "thumbnail", label: "Create thumbnail" },
    { id: "description", label: "Write title and description" },
    { id: "export", label: "Export final video" },
    { id: "upload", label: "Upload and schedule" },
  ],
};

export const PUBLISH_READINESS_ITEMS = [
  { id: "title", label: "Title chosen" },
  { id: "thumbnail", label: "Thumbnail ready" },
  { id: "description", label: "Description written" },
  { id: "tags", label: "Tags and chapters added" },
  { id: "end-screen", label: "End screen/cards set" },
  { id: "pinned-comment", label: "Pinned comment drafted" },
  { id: "scheduled", label: "Upload scheduled" },
];

export interface ProductivityState {
  checkedStageItems: Record<string, Record<string, boolean>>;
  blockedStages: Record<string, { blocked: boolean; reason?: string; updatedAt: string }>;
  publishReadiness: Record<string, boolean>;
  stageTaskLabelOverrides: Record<string, Record<string, string>>;
  tasks: Array<{
    id: string;
    label: string;
    completed: boolean;
    minutes?: number;
    createdAt: string;
  }>;
  pauseEvents: Array<{
    id: string;
    blockId: string;
    stageId: string | null;
    reason: PauseReasonId;
    phase: "work" | "break";
    startedAt: string;
  }>;
}

const EMPTY_STATE: ProductivityState = {
  checkedStageItems: {},
  blockedStages: {},
  publishReadiness: {},
  stageTaskLabelOverrides: {},
  tasks: [],
  pauseEvents: [],
};

function storageKey(videoId: string) {
  return `cadence.productivity.${videoId}`;
}

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadState(videoId: string): ProductivityState {
  if (!canUseStorage()) return EMPTY_STATE;
  const raw = localStorage.getItem(storageKey(videoId));
  if (!raw) return EMPTY_STATE;
  try {
    return { ...EMPTY_STATE, ...(JSON.parse(raw) as ProductivityState) };
  } catch {
    localStorage.removeItem(storageKey(videoId));
    return EMPTY_STATE;
  }
}

function saveState(videoId: string, state: ProductivityState) {
  if (!canUseStorage()) return;
  localStorage.setItem(storageKey(videoId), JSON.stringify(state));
}

function newId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useProductivityState(videoId?: string) {
  const [state, setState] = useState<ProductivityState>(EMPTY_STATE);

  useEffect(() => {
    setState(videoId ? loadState(videoId) : EMPTY_STATE);
  }, [videoId]);

  const commit = (updater: (current: ProductivityState) => ProductivityState) => {
    if (!videoId) return;
    setState((current) => {
      const next = updater(current);
      saveState(videoId, next);
      return next;
    });
  };

  return {
    state,
    toggleStageItem(stageId: string, itemId: string) {
      commit((current) => ({
        ...current,
        checkedStageItems: {
          ...current.checkedStageItems,
          [stageId]: {
            ...(current.checkedStageItems[stageId] ?? {}),
            [itemId]: !(current.checkedStageItems[stageId]?.[itemId] ?? false),
          },
        },
      }));
    },
    setStageBlocked(stageId: string, blocked: boolean, reason?: string) {
      commit((current) => ({
        ...current,
        blockedStages: {
          ...current.blockedStages,
          [stageId]: {
            blocked,
            reason: reason?.trim() || undefined,
            updatedAt: new Date().toISOString(),
          },
        },
      }));
    },
    togglePublishItem(itemId: string) {
      commit((current) => ({
        ...current,
        publishReadiness: {
          ...current.publishReadiness,
          [itemId]: !(current.publishReadiness[itemId] ?? false),
        },
      }));
    },
    addTask(label: string, minutes?: number) {
      const cleanLabel = label.trim();
      if (!cleanLabel) return;
      commit((current) => ({
        ...current,
        tasks: [
          ...current.tasks,
          {
            id: newId(),
            label: cleanLabel,
            completed: false,
            minutes,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    toggleTask(taskId: string) {
      commit((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? { ...task, completed: !task.completed } : task,
        ),
      }));
    },
    deleteTask(taskId: string) {
      commit((current) => ({
        ...current,
        tasks: current.tasks.filter((task) => task.id !== taskId),
      }));
    },
    renameTask(taskId: string, label: string) {
      commit((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? { ...task, label: label.trimStart() } : task,
        ),
      }));
    },
    renameStageTask(stageId: string, itemId: string, label: string) {
      commit((current) => ({
        ...current,
        stageTaskLabelOverrides: {
          ...current.stageTaskLabelOverrides,
          [stageId]: {
            ...(current.stageTaskLabelOverrides[stageId] ?? {}),
            [itemId]: label.trimStart(),
          },
        },
      }));
    },
    logPause(event: Omit<ProductivityState["pauseEvents"][number], "id" | "startedAt">) {
      commit((current) => ({
        ...current,
        pauseEvents: [
          {
            ...event,
            id: newId(),
            startedAt: new Date().toISOString(),
          },
          ...current.pauseEvents,
        ].slice(0, 40),
      }));
    },
  };
}
