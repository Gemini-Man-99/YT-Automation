# YT Automator — Dashboard

A single-page React dashboard for turning videos into narrated highlight clips
and countdown shorts. Coffee + cream theme, responsive for mobile / iPad / desktop.
The app has two pages: the **Builder** (configure and start jobs) and the
**Library** (every finished video). A **Library** link with a count badge sits in
the top-right of the header on every view; the Library is a full page with a
**← Back to builder** link.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Configure API access

Processing calls the Excido API. Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Set `VITE_EXCIDO_API_KEY` and `VITE_EXCIDO_USER_EMAIL` (sent as the `X-API-Key` and
`X-User-Email` headers). In local dev, leave `VITE_EXCIDO_API_BASE=/excido` to use the
Vite proxy in `vite.config.js`, which forwards to `https://api.excido.app` and avoids
CORS. Until both credentials are present, the Start button is disabled and a warning
banner is shown.

## Structure

```
├── index.html               # Vite entry HTML
├── package.json
├── vite.config.js           # dev server + /excido → api.excido.app proxy
├── .env.example             # copy to .env and add your Excido credentials
├── src/
│   ├── main.jsx             # React entry point
│   ├── index.css            # global resets
│   ├── api/excido.js        # Excido client (upload → create → poll → cancel/retry)
│   └── YTDashboard.jsx      # the dashboard component
├── excido.selftest.mjs      # pure-function tests: node excido.selftest.mjs
└── yt-dashboard-preview.html # standalone no-build preview (double-click to open)
```

## Builder

1. **Video Ingestion** — link bar, category dropdown, file upload (5 MB resumable
   chunks), and Clean / Cliffhanger slice mode.
2. **Clip Settings** — clip duration, target aspect ratio, layout style
   (Glassmorphism / Fit / Stretched / Elongated), and subtitle preset, size, and position.
3. **Output Format** — Highlight Clips (border color + background music) or
   Countdown Short (countdown topic).
4. **Processing Dashboard** — a live 5-step pipeline driven by the Excido job status,
   with Cancel and Retry. Jobs that are still running or have failed stay here; once a
   job finishes it leaves the dashboard and appears in the Library.

## Library

A full page listing every finished video, newest first, reached from the **Library**
link in the header. The link shows a count badge (highlighted when new videos have
arrived while you were on the Builder), and a green nudge banner appears on the Builder
when a job completes. The Library page has a **← Back to builder** link. Each card offers:

- a **poster-before-play** player (loads the video only when you press play; uses the
  API's thumbnail as the poster when available),
- a **settings summary** of the options the clip was rendered with,
- **Download MP4** and **Copy link** actions, and
- a **Make another** button to jump back to the Builder.

## Build for production

```bash
npm run build
npm run preview
```

> Note: `src/YTDashboard.jsx` (the React app) and `yt-dashboard-preview.html` (the
> no-build preview) are intentional mirrors of the same UI — keep them in sync when
> changing either.
