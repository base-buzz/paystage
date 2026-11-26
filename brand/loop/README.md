# The loop

Rendered by `node scripts/render-loop.mjs` at 4 fps for 30s → 120 frames per aspect.

```bash
# assemble (ffmpeg is not installed in this container)
ffmpeg -framerate 4 -i square-%04d.png -pix_fmt yuv420p loop-square.mp4
ffmpeg -framerate 4 -i wide-%04d.png -pix_fmt yuv420p loop-wide.mp4
```

The numbers in scenes 1 and 2 are a **stated example**, not a measurement: they live in `EXAMPLE` at the top of the
script so a real reading can replace them. Re-run after a mark change — the script refuses if the brand check fails,
because an animation of a superseded logo is the most expensive kind of stale.
