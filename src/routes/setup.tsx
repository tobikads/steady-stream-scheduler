import { AppShell } from "@/components/AppShell";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useCurrentWeek } from "@/hooks/use-current-week";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { applyRebalance } from "@/lib/week-setup";
import { STAGE_DEFAULTS, STAGE_LABEL, StageKind, TOTAL_WEEKLY_BLOCKS } from "@/lib/schedule";
import { toast } from "sonner";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
  head: () => ({
    meta: [
      { title: "Setup — Cadence" },
      { name: "description", content: "Adjust this week's stage estimates." },
    ],
  }),
});

function SetupPageInner() {
  const { data, loading, refresh } = useCurrentWeek();
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const d: Record<string, number> = {};
    data.stages.forEach((s) => (d[s.id] = Number(s.planned_blocks)));
    setDrafts(d);
    setTitle(data.video.title);
  }, [data?.videoId]);

  if (loading || !data) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const total = Object.values(drafts).reduce((a, b) => a + b, 0);
  const overBudget = total > TOTAL_WEEKLY_BLOCKS;

  const save = async () => {
    setSaving(true);
    try {
      await supabase.from("videos").update({ title }).eq("id", data.videoId);
      await Promise.all(
        Object.entries(drafts).map(([id, val]) =>
          supabase.from("stages").update({ planned_blocks: val }).eq("id", id)
        )
      );
      await applyRebalance(data.videoId);
      toast.success("Saved and rebalanced.");
      refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Video setup</h1>
        <p className="text-sm text-muted-foreground">Tune this week's stage estimates.</p>
      </div>

      <Card className="p-5 space-y-2">
        <Label htmlFor="title">Video title</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Card>

      <Card className="p-5 space-y-5">
        {data.stages.map((s) => {
          const kind = s.kind as StageKind;
          const cfg = STAGE_DEFAULTS[kind];
          const val = drafts[s.id] ?? Number(s.planned_blocks);
          return (
            <div key={s.id} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{STAGE_LABEL[kind]}</span>
                <span className="tabular-nums text-muted-foreground">
                  {val.toFixed(1)} blocks
                  <span className="ml-2 text-xs">({cfg.min}–{cfg.max})</span>
                </span>
              </div>
              <Slider
                value={[val]}
                min={cfg.min}
                max={cfg.max}
                step={0.5}
                onValueChange={(v) => setDrafts((d) => ({ ...d, [s.id]: v[0] }))}
              />
            </div>
          );
        })}
      </Card>

      <Card className={`p-5 flex items-center justify-between ${overBudget ? "border-destructive/50" : ""}`}>
        <div>
          <div className="text-sm text-muted-foreground">Total planned</div>
          <div className="text-2xl font-semibold tabular-nums">
            {total.toFixed(1)} <span className="text-base text-muted-foreground">/ {TOTAL_WEEKLY_BLOCKS} blocks</span>
          </div>
          {overBudget && (
            <p className="text-xs text-destructive mt-1">
              {(total - TOTAL_WEEKLY_BLOCKS).toFixed(1)} blocks over capacity. Trim a stage or accept a slip.
            </p>
          )}
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save & rebalance"}
        </Button>
      </Card>
    </div>
  );
}


function SetupPage() { return <AppShell><SetupPageInner /></AppShell>; }
