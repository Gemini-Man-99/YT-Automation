# YT Automator — Dashboard

A single-page React dashboard for turning videos into narrated highlight clips
and countdown shorts. Brown + cream theme, responsive for mobile / iPad / desktop.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Structure

```
├── index.html               # Vite entry HTML
├── package.json
├── vite.config.js
├── src/
│   ├── main.jsx             # React entry point
│   ├── index.css           # global resets
│   └── YTDashboard.jsx     # the dashboard component
└── yt-dashboard-preview.html   # standalone no-build preview (double-click to open)
```

## The four sections

1. **Video Ingestion** — link bar, category dropdown, Clean / Cliffhanger slice mode.
2. **AI Settings** — commentary tone (Educational / Funny / Critical) + context/memory box.
3. **Output Format** — Highlight Clips (16:9, border color + music) or Countdown Short (9:16, topic).
4. **Processing Dashboard** — animated 5-step pipeline, then a result card with player + Download MP4.

> The pipeline is a front-end mock (timed steps). Wire the "Start Process" handler
> in `YTDashboard.jsx` to your real backend when ready.

## Build for production

```bash
npm run build
npm run preview
```
