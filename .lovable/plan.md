
# Weekly Video Production Planner

A single-user web app that turns your weekly video into a living schedule. You log what you actually do each day, and the plan rebalances itself so you still ship on Saturday.

## Your fixed weekly capacity (baked in, not optional)

Every day has 2 video work blocks: **9:00–12:30** and **2:30–6:00**.
Tue, Thu, Fri, Sat also have a third evening block: **8:00–11:30 PM**.

| Day | Blocks | Total |
|-----|--------|-------|
| Mon | AM, PM | 2 |
| Tue | AM, PM, Eve | 3 |
| Wed | AM, PM | 2 |
| Thu | AM, PM, Eve | 3 |
| Fri | AM, PM, Eve | 3 |
| Sat | AM, PM, Eve | 3 |
| **Week total** | | **16 blocks** |

This comfortably covers the full ~16.5-block production process. No "stretch / maybe" blocks — these slots are scheduled work and the planner treats them as committed.

## Stages with default block estimates (editable per video)

- Research: 2 (range 1–3)
- Scripting: 3.5
- Recording: 1
- Cleaning up video: 3.5
- Laying out clips: 2.5 (range 2–3)
- Editing: 2.5 (range 2–3)
- Finishing touches: 1.5
- **Default total: 16.5 blocks** → fits the 16-block week when Research lands at 1.5 or you carry 0.5 block into Saturday evening. Planner shows the math live as you adjust.

## How the system stays dynamic

1. **Start of week (Mon AM)**: confirm/adjust this video's stage estimates. Planner lays them onto the 16 fixed blocks Mon→Sat in production order.
2. **Each block**: clock in → work → clock out. Hourly 15-min break reminders. The block's actual minutes and stage progress are recorded.
3. **End of each block + end of day**: mark stage % complete and confirm. Planner immediately:
   - **Behind**: redistributes leftover work onto the remaining scheduled blocks. Flags exactly which upcoming blocks now have more on them and whether Saturday delivery is still safe.
   - **Ahead**: pulls future work earlier and shows you the free time you've earned (you can choose to bank it, end early, or get a head start on next week's research).
4. **Risk warnings**: if at any check-in Saturday delivery is at risk even with all 16 blocks used, you get a clear alert with options — trim a stage's scope, or accept the slip.

## Main screens

### 1. Today
- The day's scheduled blocks listed by clock time, each tagged with its stage assignment.
- Big **Clock In / Clock Out** button for the active block, with a live timer and break reminders.
- Quick-log: "Finished X", "Got Y% through Z" — recomputes the week instantly.
- End-of-day summary: blocks done vs. planned, % per stage, what's on tomorrow.

### 2. Week view
- Mon–Sat grid showing every block (AM, PM, Eve where applicable) with its assigned stage and status (done / in progress / upcoming).
- Top status bar: "On track / Ahead by X blocks / Behind by Y blocks — Saturday delivery [safe / at risk]".
- Saturday is the fixed release deadline with a countdown.

### 3. Video setup
- Sliders for each stage's block estimate (within their min–max).
- Live read-out of total blocks vs. 16 available, plus projected finish block.

### 4. History
- Past weeks: planned vs. actual per stage. Helps you tune your own estimates over time (e.g. "you average 3 blocks for editing, not 2.5").

## Tech approach

- **Frontend**: TanStack Start routes (`/`, `/week`, `/setup`, `/history`), React + Tailwind, shadcn/ui components.
- **Persistence**: Lovable Cloud (Postgres + auth) so data syncs across devices and history accrues. Tables: `videos` (one per week), `stages` (per video with planned/actual blocks), `blocks` (the 16 weekly slots with assigned stage and clock-in/out timestamps), `daily_logs`.
- **Schedule template**: the Mon–Sat block layout above is a fixed weekly template seeded for every new week — it isn't asked for each time.
- **Rebalancing logic**: pure TypeScript `rebalance(video, now)` function. Recomputes remaining blocks per stage and reassigns them to remaining slots in production order. Runs after every clock-out and check-in.
- **Notifications**: in-app toasts for break time, end-of-block, end-of-day check-in. (No push/email in v1.)
- **Design**: focused, calm, dark-mode friendly. Big timer numerals, clear progress bars per stage. Feels like a coach, not a spreadsheet.

## Not in v1

- Multi-user / team features
- Google/Apple Calendar sync
- Native mobile app (responsive web only)
- AI suggestions — rebalancing is deterministic on purpose
