# OP-133 Instagram editor and post cards: build notes

Frames in the design file OpenCat.pen; WebP exports here (1600 wide):
1 single image `n1pZY` · 2 carousel `eCBgG` · 3 Reel `rwN9U` · 4 warnings `HlAzi` · 5 post cards `PHgSZ`.

Base: the TikTok editor from OP-117 (dialog 900 wide, 620px form, 280px preview). Instagram mark as in OP-130.

## Editor

- Header "New Instagram post" + format name; account chip "@acme.studio" with the mark.
- Format control "Image · Carousel · Reel", styled like TikTok's "How to post".
- Counters on one line, mono 11: "1,184 / 2,200 · # 8 / 30 · @ 2 / 20"; each is its own text so one can turn red.
- Image: 4:5 tile, "Sent as JPEG", Replace / delete. Feed-style preview.
- Carousel: 64×80 tiles with position number and grip; the dragged tile lifts with an accent outline and shadow, a dashed slot shows where it lands; "+ Add"; "5 of 10"; "Drag to reorder. The first one is the cover." Preview shows "1/5" and dots. Images and videos can mix.
- Reel: 9:16 tile, Cover section with a 10-frame filmstrip and "Use an image instead"; Reels-style preview.
- Warnings: empty drop area with "Instagram needs an image or video" (Schedule disabled); "# 31 / 30" in red with "Instagram allows up to 30 hashtags"; note "PNG and HEIC images are sent as JPEG."
- Assumed limits drawn as hints, to confirm: images up to 8 MB, 4:5 to 1.91:1, videos up to 60 s, MP4 or MOV 9:16.

## Post cards (chat panel, frame 5)

- Publishing: spinner, "opening a tunnel, Instagram is fetching 3 files", accent progress "1 of 3".
- Retrying (amber): "Couldn't reach Instagram · trying again at 14:36 (2 of 3)", Retry now.
- Failed (red): "Instagram couldn't fetch the files", Retry, Details.
- No tunnel tool (red): "Install cloudflared or ngrok, then retry.", How to install (opens Integrations › Instagram, step 6), Retry.
- Daily limit (blue): "Waiting for the next free slot · 100 posts in 24 h reached · goes out at 09:12".

## Answers from Luna (msg 3484)

1. Anything Instagram would refuse blocks Schedule: no media, more than 30 hashtags, 20 mentions or 2,200 characters.
2. Reel cover: a video frame or an uploaded image, both.
3. Alt+arrows reorder the carousel from the keyboard.
4. The retrying card shows "2 of 3".
5. A post waiting for the daily limit moves to its new time on the calendar.
6. Details opens inside the card, no modal.

Limits: Reels are 3 s to 15 min and up to 300 MB (the frames' "Videos up to 60 s" hint is wrong; use these). Images up to 8 MB, 4:5 to 1.91:1.
