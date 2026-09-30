# OP-123 Interactions: build notes

Frames in the design file OpenCat.pen; WebP exports here (1600 wide):
1 inbox, 1280 chat closed `wLcQg` · 2 inbox, 1280 chat open, Draft modal `zf8Ec` · 2b modal loading `PprA3` · 2c modal, agent not set up `w2uTNK` · 2d modal, draft failed `kBFYv` · 3 schedule a reply `J74har` · 4 waiting for approval `ZKCwZ` · 5 refreshing `lkPhl` · 6 empty `t3DV4b` · 7 TikTok account `nzcrM` · 8 960×600 chat open `HG7mc` · 9 960×600 chat closed `O0em2W` · 3b/3c/3d schedule at 1280 chat open, 960 chat open, 960 chat closed `x6pU9p` `FEytL` `c7x0Bx` · 4b/4c/4d approval `PcU9W` `YpTIf` `naQ2v` · 5b/5c/5d refreshing `CCJkQ` `H6qsjV` `Zzilt`.

## Page (Milo, OP-125)

- Sidebar: Dashboard, Calendar, Interactions (lucide `message-circle-reply`), Approvals.
- Header: "Interactions @acme", "Last synced …", "Refresh · about $0.10"; line "Reads the last 100 replies to your posts. Estimated, prices as of 30 Sep 2026 · X's pricing ↗".
- Filters: Segmented style, Unanswered (default, count) · All · Waiting for approval (count); "On one post ▾" on the right.
- Closed item: 8px unread column (7px `$ds-accent` dot), 32px avatar, name 13/600, @handle and time 12 `$ds-text-3`, reply 13/1.5 up to 3 lines, "↳ on your post: …" 12 `$ds-text-3`. Padding 14/16/14/12, gap 12, bottom border `$ds-border`.
- Open item: `$ds-raised`, stroke `$ds-border-strong`, radius 12, padding 16. "Your post" block (`$ds-inset`, radius 10, padding 12): full text, 56px media thumb, date, views/likes/replies, "Open on X ↗"; threads list parts, the replied part in `$ds-raised` with a 2px `$ds-accent` left border and "Replying to part N"; reply-to-a-reply shows the chain (2 visible, "+N more in this conversation").
- Reply box: textarea `$ds-inset`, radius 10, 96px (64 at 960), counter "0 / 280" mono 11, border `$ds-accent` with text. Buttons 32px, radius 8: Draft with Claude · Schedule · Reply now (50% while empty). Line "A reply is a post on X · about $0.015, estimated".
- Reply now or Schedule on a drafted reply counts as approval. Approvals only hold replies the agent scheduled by itself (chat or MCP): amber StatusPill "Waiting for your approval", Approve / Edit / Reject.
- Scheduled: `$ds-accent-2` strip "Reply scheduled · Thu 09:30", Edit, Cancel.
- Draft with Claude modal: 440 wide, scrim `#00000099`; your post (compact) + the reply being answered; editable draft with counter; "Make it…" field + Regenerate; Cancel / Use this reply (fills the box). Loading, agent not set up ("Open agent settings") and failed ("Try again") states disable Use this reply.
- Refreshing: disabled "Reading replies…", 2px accent progress bar, list dimmed. Empty and TikTok states per frames 6 and 7.
- Widths: everything fill_container. 960 chat open (column 546): hide @handle and "Last synced", "Draft" short label, thread parts collapsed to "Thread of 4 · show parts".
- Narrow columns (1280 chat open, 960 chat open): the schedule picker wraps to two rows ("Post the reply on" + date + time, then Cancel + full-width "Schedule reply"), and the Draft / Schedule / Reply now row hides while it's open. The approval note "Approving posts it at … · about $0.015, estimated" moves below Approve / Edit / Reject, which stay on one row. "Reading replies…" fits as is.
- Open: sidebar badge for Interactions? Does Unanswered include replies with a scheduled answer? Truncation rules for long text.

## Data (Orion, OP-124)

- Your post block needs text, media thumb, stats, thread parts with position, and the chain between your post and the reply (count + last 2).
- Confirm what one refresh reads (100 replies, about $0.10) and whether chains cost extra reads; a reply costs about $0.015.
- Agent-scheduled replies need a source ("Claude from the chat" / "an agent over MCP") for the approval card.
