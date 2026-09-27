# Writing a video: the HyperFrames composition contract

Adapted for OpenCatt from HyperFrames v0.8.80 (github.com/heygen-com/hyperframes, Apache-2.0):
skills/hyperframes-core/SKILL.md and references/{minimal-composition,determinism-rules}.md. The CLI,
Studio, sub-composition and media parts are left out, because OpenCatt records one self-contained page.

A video is one HTML page whose DOM declares timing with `data-*` attributes and whose animation is a
paused, seekable GSAP timeline. OpenCatt seeks it frame by frame at 30 fps and records every frame, so
each frame must be reproducible from its time alone: same time, same pixels.

## What OpenCatt gives the page

- GSAP 3.15 is already loaded as `window.gsap`, and the HyperFrames runtime is already on the page.
  Do not add `<script src>` tags: the page has no network, and any request is refused.
- No images or fonts from the internet. Use system fonts (system-ui, Helvetica, Georgia, Menlo), or
  embed a font or image as a `data:` URL. A named `font-family` needs an in-file `@font-face` with a
  `data:` source.
- The user's own files (a logo, a photo, footage) are placed as they are, never redrawn: list their
  media ids in `assets` and load each as `asset://<media id>`, in an `<img>` or a
  `<video muted>` with `data-start` and `data-duration`, whose playback the runtime seeks.
- Videos are silent: no `<audio>`, and no `<video>` other than the user's own footage.

## The skeleton

```html
<!doctype html>
<html>
  <head>
    <style>
      body {
        margin: 0;
        background: #0b0f14;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      #root {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .clip {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="1280"
      data-height="720"
      data-duration="15"
    >
      <section id="intro" class="clip" data-start="0" data-duration="5">
        <h1 id="title">Hello</h1>
      </section>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true })
      tl.from('#title', { y: 48, opacity: 0, duration: 0.6, ease: 'power3.out' }, 0.2)
      window.__timelines['main'] = tl
    </script>
  </body>
</html>
```

## Structure

- One root `<div>` directly in `<body>` (no `<template>`), with `data-composition-id`, `data-width`,
  `data-height` and `data-duration` (seconds). `data-width` and `data-height` must equal the video's
  width and height. The root's own CSS is `width: 100%; height: 100%`: never hardcode its pixels.
- The video is exactly the root's `data-duration` long, read once before scripts run. A timeline that
  runs past it is cut off; one that ends early holds its last frame. Set it to the length you record.
- Timed elements (clips) carry `data-start` and `data-duration`, in seconds. A clip is visible in
  `[start, start + duration)`; the runtime shows and hides clips itself. `class="clip"` is only a
  layout convention.

## One paused timeline

- Exactly one `gsap.timeline({ paused: true })`, registered at `window.__timelines["<id>"]`, where
  `<id>` is the root's `data-composition-id`. The registry already exists; don't create it.
- Register it only after every tween has been added. Building inside `document.fonts.ready` is fine,
  as long as the assignment comes last.
- Never call `tl.play()`. Never use `repeat: -1`: compute a finite count with
  `Math.max(0, Math.floor(duration / cycle) - 1)`.
- Don't create empty tweens to pad the length; use `data-duration`.

## Determinism: never use these for what's on screen

- `Date.now()`, `performance.now()`, or any clock. Time comes only from the timeline.
- Unseeded `Math.random()`. For random-looking layouts, use a small seeded PRNG.
- Network fetches of any kind.
- Hover, scroll, pointer or focus state. There is no input.
- Animating the same property of the same element from two timelines at once.

## Pitfalls that break a render silently

- Never tween `display`, `visibility` or `autoAlpha` on a `.clip` element: the runtime owns clip
  visibility. Fade with `opacity`, or animate a child.
- Never pair a CSS `transform` with a GSAP tween of the same property on the same element. Set the
  start inside the tween with `gsap.fromTo(el, { x: -40 }, { x: 0 })`. Center with flex, grid or
  `inset`, not `translate(-50%, -50%)` on an element you then move with `x`/`y`; or use
  `xPercent`/`yPercent`.
- Transformed elements must be block-level and sized: `scaleX` on an inline `<span>` or on a
  zero-width element shows nothing. Give bars and fills `display: block` and a real width and height.
- Absolutely positioned decorations that pulse or overshoot (`yoyo` scale, `back.out`) need room at
  their largest size, clear of any `overflow: hidden` edge.
- No `<br>` in body text; let text wrap with `max-width`. Short display titles with one word per line
  are the exception.
- Keep every `id` unique.

## Layout

Build the finished frame in static HTML and CSS first, then animate from and to it. Fill scenes with
`width: 100%; height: 100%; box-sizing: border-box`, and lay content out with flex, grid, padding and
`max-width` rather than hardcoded `top`/`left`. Use `position: absolute` for layers and decorations.
Prefer transforms and opacity. For text that must fit a box, use
`window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`.
