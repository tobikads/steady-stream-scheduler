## What I'll change

### Today page — becomes a focused work cockpit

- **Replace the "Stage progress" card** with a **Timer panel** in the same slot.
  - When no block is active: shows the next block + countdown ("Next: Tue 9:00 AM in 1h 14m") and a big "Clock in" button for the current/next block.
  - When clocked in: large running timer (HH:MM:SS) front-and-center, showing which stage you're on, target 1-hour work segment with a ring/progress that fills as the hour ticks.
  - At the 1-hour mark: auto-switches to a **Break timer** (15 min) with its own countdown ring + a "Skip break / Back to work" button. Plays a soft chime + toast when work hour ends and when break ends.
  - "Clock out" button stays here, opens the same inline % + full-block confirm panel.
- **Keep** the editable title and the status bar (ahead/behind, buffer, blocks remaining).
- **Remove** the today-blocks list duplication — only show the active block + next block in the timer panel. Today's other blocks listed compactly below the timer (time + stage label + status badge), no action buttons.

### Week page — becomes the dashboard

- **Add Overall progress card** at top: single large progress bar = sum(actual_blocks) / sum(planned_blocks) across all stages, with "X% of this week's video complete" and a blocks-completed/blocks-total readout.
- **Add Stage progress card** (the one currently on Today) showing each stage's bar and completion check.
- **Week grid stays** but becomes read-only: each block shows status badge (upcoming / done / skipped / in progress) and stage label. Today's column still highlighted. **Remove** the Start / Skip / Restore buttons — those live on Today only.

### Bug fixes (the "nothing happens" problems)

- Title edit: investigate why the save isn't sticking. Likely the `onBlur` fires before state updates or the toast/error path is being swallowed. I'll add explicit logging, ensure `refresh()` re-pulls the video row, and confirm the update returns successfully (also check that `setEditingTitle(false)` doesn't unmount the input mid-save).
- Clock in / save & rebalance: I'll verify in the console + network panel what's actually happening on click. If RLS or a missing field is rejecting the write, I'll surface the exact error and fix it. If the writes succeed but the UI doesn't refresh, I'll force a refetch + add a brief loading state so the user sees feedback.

### Files touched

- `src/routes/today.tsx` — new TimerPanel component (work + break phases), drop stage-progress card, slim today-blocks list.
- `src/routes/week.tsx` — add OverallProgress + StageProgress cards, strip action buttons from blocks.
- `src/lib/schedule.ts` — add a small `overallProgress(stages)` helper if not already there.
- Light shared component: `src/components/TimerRing.tsx` for the circular timer used by both work and break phases.

### Out of scope (ask if you want them)

- Notifications when the browser tab is hidden (Web Notifications API)
- Configurable work/break durations (currently hardcoded 60 min work + 15 min break per your earlier rule)
- Pausing the timer mid-block
