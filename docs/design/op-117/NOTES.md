# OP-117 build notes

Frames in the design file OpenCat.pen; WebP exports here (1600 wide):
1 switcher `R3h9FH` · 2 add account `YxYZT` · 3 TikTok setup `njHRv` · 4 editor draft `tzyUk` · 5 editor direct `Vfd18` · 6 editor errors `W7C3H` · 7 calendar, TikTok account `O7ozRp` · 8 Dashboard TikTok `vaTrb`.

Ignore stale sidebar items (Posted, Drafts) in these frames; the app has Dashboard, Calendar, Approvals.

## Platform marks (placeholders, not official logos)

- X: tile `#000000`, 1px `$ds-border`, radius ≈ 0.28×size, white "X" Geist bold ≈ 0.6×size.
- TikTok: tile gradient 135° `#FE2C55 → #25F4EE`, same radius, white lucide `music-2` ≈ 0.62×size.
- Sizes: 16 in the chat card and dashboard header · 18 in the editor account chip · 20 in add-account and setup heading · 14 as a badge on avatars (1.5px `$ds-surface` ring).

## Oscar (accounts, TikTok connect and publish)

- Switcher: badge on the avatar, handle line "@acme · X" / "@acme.hq · TikTok", menu title "ACCOUNTS".
- Setup is an in-app page under Integrations, three steps, not the first-run wizard.
- Editor: "How to post" = Send to TikTok as a draft (default) | Post directly. Direct shows privacy (Public / Friends / Only me, none selected, error "Choose who can see it"), Allow comments / Duet / Stitch, Disclose commercial content (Your brand → "Promotional content", Branded content → "Paid partnership").
- Warnings: no video ("A TikTok post needs a video", Schedule disabled); 5 inbox drafts waiting; not reviewed yet → direct posts are Only me.
- Chat card after sending: "Sent to your TikTok inbox · open TikTok to finish it", Copy caption, Open TikTok ↗.
- Open: disabled Duet/Stitch when the account turned them off in TikTok; redirect URI is `http://127.0.0.1:47825/callback/` (trailing slash; Oscar) (frame 3 shows it). X stays on 47823; 47824 is the MCP server.
- Calendar shows only the active account's posts (Hera, 30 Sep), so chips carry no platform mark. New chip state "sent to inbox": `$ds-inset` fill, 1px `$ds-border-strong`, lucide `inbox` 11px + time + title in `$ds-text-2`.

## Milo (Dashboard)

- Frame 8 follows OP-121's plan: no All posts / Made in OpenCatt switch, Views over time chart kept, 3 Top videos cards.
- TikTok: Followers (+delta since last refresh, needs follower snapshots), Likes, Videos; Views by video, Engagement rate = (likes + comments + shares) ÷ views; Top videos (9:16 thumbs), All videos table without Cost.
- Plain "Refresh", "Last updated 5 min ago", no cost or price line. Lists say "public videos only".
