## What's broken & what's missing

After reviewing the code, here's what I found and how I'll fix it:

### Bugs
1. **Clock-in does nothing visible** — the click likely succeeds against the database but there's no error surfacing if it fails (e.g. RLS, stale session). I'll add error toasts on every Supabase write so silent failures stop being silent, and refresh state after every mutation.
2. **Save & rebalance does nothing visible** — same root cause. The `.update()` calls don't check `error`, so a failure shows nothing. I'll also force a refresh and a clear "Saved" toast only when the writes actually succeed.
3. **Video title not editable from Today** — currently you have to go to /setup. I'll add an inline editable title at the top of the Today page.

### Interactivity upgrades
4. **Week tab is static** — I'll make each block clickable: shows status (upcoming / in progress / done / skipped), lets you clock in or mark a block done/skipped from the week view, and visually flags today's blocks.
5. **Today page polish** — show a "next block starts in…" countdown, surface the active stage progress at the top, and make the clock-out flow inline instead of a modal.
6. **History tab** — add a per-stage efficiency view (avg actual vs planned across all videos) so you can see which stages you consistently under/over-estimate. Also add a "create next week's video" button so you're not stuck waiting.

### Plan in detail

**Files to change**

- `src/routes/today.tsx`
  - Inline editable video title (click to edit, save on blur)
  - Wrap every Supabase call in try/catch with toast.error on failure
  - Show "Next block: 2:30 PM (in 1h 14m)" when no block is active
  - Replace clock-out modal with an inline expanding panel under the active block
- `src/routes/week.tsx`
  - Each block becomes interactive: badge for status, clock-in button if today, "mark done"/"skip" menu
  - Highlight today's column
  - Show stage progress chip per block
- `src/routes/setup.tsx`
  - Surface errors on save; toast only fires after writes confirm; refresh data after rebalance
- `src/routes/history.tsx`
  - Add "Estimation accuracy" card: per-stage avg actual/planned ratio across videos
  - Add "Start next week" button that creates the next Monday's video
- `src/lib/week-setup.ts`
  - Add `createNextWeek(userId)` helper that mirrors `ensureCurrentWeek` for a given Monday
  - Make `applyRebalance` return a success/error so callers can surface it

**No schema changes** — all the data we need is already in the tables; this is a UX & wiring fix.

### Out of scope (ask if you want them)
- Drag-and-drop reassignment of blocks to stages
- Notifications outside the app (email/push when behind schedule)
- Multi-video pipeline (working on next week's research while finishing this week's edit)
