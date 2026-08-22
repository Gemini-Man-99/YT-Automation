// ============================================================
//  YT Automator — Dashboard
//  Single-file React component (functional + Hooks only).
//
//  Requirements covered:
//    • Section 1: Video Ingestion (link bar, category dropdown,
//      slice mode toggle: Clean / Cliffhanger)
//    • Section 2: Clip Settings (duration, aspect ratio, Layout
//      Style preview cards, Subtitle Preset cards, subtitle size,
//      and a 3×3 Subtitle Position grid — beta: Bottom-Centre only)
//    • Section 3: Output Format (Highlight 16:9 with border color
//      & music track, or Countdown Short 9:16 with countdown topic)
//    • Section 4: Processing queue (5 steps, live status), result
//      card with video player + Download MP4 button
//    • Theme: brown + cream, warm & modern
//    • Fully responsive: mobile / iPad / desktop
//
//  No browser storage APIs. Timers cleaned up on unmount.
// ============================================================

import { useEffect, useRef, useState } from "react";
import {
  hasApiKey,
  uploadFile,
  probeMediaMetadata,
  createJob,
  pollJobStatus,
  cancelJob,
  retryJob,
  buildCreateJobPayload,
  normaliseSteps,
  deriveSteps,
  API_STEPS,
} from "./api/excido";

const COFFEE = {
  900: "#4b2e1d",
  800: "#6b4226",
  700: "#8a5a33",
  600: "#a97142",
  500: "#c68a55",
  400: "#d9a877",
  300: "#e6c39d",
  200: "#f0dcc3",
  100: "#f7ecdd",
};

const CREAM = "#faf3e7";
const ACCENT = "#d9803e";
const CREAM_CARD = "#fdf8ef";

const CATEGORIES = ["Movie", "TV Show", "Gaming", "Podcast"];
const BORDERS = ["#8a5a33", "#d9803e", "#e6c39d", "#5b3a24", "#c68a55"];

// Pipeline steps mirror the Excido API's status pipeline (see api/excido.js).
const STEPS = API_STEPS;

const MUSIC = [
  "Neon Nights (Synth)",
  "Golden Hour (Lo-fi)",
  "Rising Tension (Cinematic)",
  "Chill Hop (Hip-hop)",
  "Silence (No music)",
];

// ---- Clip Settings options ----
const DURATIONS = [
  { value: "auto", label: "Auto" },
  { value: "under30", label: "Under 30s" },
  { value: "30-60", label: "30–60s" },
  { value: "60-90", label: "60–90s" },
];
const ASPECTS = [
  { value: "16:9", label: "16:9 · Landscape" },
  { value: "9:16", label: "9:16 · Vertical" },
  { value: "1:1", label: "1:1 · Square" },
  { value: "4:5", label: "4:5 · Portrait" },
];
const LAYOUTS = [
  { value: "glass", label: "Glassmorphism" },
  { value: "fit", label: "Fit Screen" },
  { value: "stretched", label: "Stretched" },
  { value: "elongated", label: "Elongated" },
];
const SUBTITLE_STYLES = [
  { value: "standard", label: "Standard Captions" },
  { value: "bold", label: "Bold Highlight" },
  { value: "neon", label: "Neon Glow" },
];
const SUB_SIZES = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
// Subtitle position — 3×3 grid. Value encodes vertical-horizontal placement.
const SUB_POSITION_GRID = [
  { label: "Top Left", value: "top-left" },
  { label: "Top Centre", value: "top-centre" },
  { label: "Top Right", value: "top-right" },
  { label: "Mid Left", value: "mid-left" },
  { label: "Mid Centre", value: "mid-centre" },
  { label: "Mid Right", value: "mid-right" },
  { label: "Bot Left", value: "bot-left" },
  { label: "Bot Centre", value: "bot-centre" },
  { label: "Bot Right", value: "bot-right" },
];
const labelOf = (arr, v) => (arr.find((o) => o.value === v) || {}).label || v;

// The status payload's field name for the finished file isn't fixed across
// API versions, so scan the likely keys (top-level and nested under output/
// result/media) and return the first URL-looking string we find.
function findDownloadUrl(result) {
  if (!result || typeof result !== "object") return null;
  const KEYS = [
    "output_url",
    "download_url",
    "result_url",
    "video_url",
    "url",
    "mp4_url",
    "file_url",
  ];
  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const k of KEYS) {
      const v = obj[k];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
    return null;
  };
  return (
    scan(result) ||
    scan(result.output) ||
    scan(result.result) ||
    scan(result.media) ||
    scan(result.data) ||
    null
  );
}

const pulseKeyframes = `
@keyframes ytPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
`;

const downloadKeyframes = `
@keyframes ytDownloadBounce {
  0%   { transform: translateY(0); }
  30%  { transform: translateY(3px); }
  60%  { transform: translateY(0); }
  100% { transform: translateY(0); }
}
`;

const fadeInKeyframes = `
@keyframes ytFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`;

const spinnerKeyframes = `
@keyframes ytSpin { to { transform: rotate(360deg); } }
`;

const computeLayout = () => {
  if (typeof window === "undefined") {
    return { isMobile: false, isTablet: false };
  }
  const w = window.innerWidth;
  return { isMobile: w < 640, isTablet: w >= 640 && w < 1024 };
};

export default function YTDashboard() {
  const [link, setLink] = useState("");
  const [category, setCategory] = useState("Movie");
  const [mode, setMode] = useState("clean");
  const [format, setFormat] = useState("highlight");
  const [border, setBorder] = useState(BORDERS[0]);
  const [music, setMusic] = useState(MUSIC[0]);
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("auto");
  const [aspect, setAspect] = useState("16:9");
  const [layoutStyle, setLayoutStyle] = useState("glass");
  const [subStyle, setSubStyle] = useState("standard");
  const [subSize, setSubSize] = useState("medium");
  const [subPosition, setSubPosition] = useState("bot-centre");
  const [jobs, setJobs] = useState([]);
  const [layout, setLayout] = useState(computeLayout);
  const [playerJob, setPlayerJob] = useState(null);
  const [file, setFile] = useState(null);

  // Per-job control handles: { stop } for the status poller and { abort }
  // for any in-flight upload/create request. Keyed by the job's local id.
  const jobControlRef = useRef({});
  const mountedRef = useRef(true);

  // A job is "active" while it's uploading, being created, queued, or
  // processing. Terminal states (completed / failed / cancelled) are idle.
  const ACTIVE_STATUSES = ["uploading", "creating", "queued", "processing"];
  const busy = jobs.some((j) => ACTIVE_STATUSES.includes(j.status));
  const apiKeyMissing = !hasApiKey();

  useEffect(() => {
    const onResize = () => setLayout(computeLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Stop all pollers and abort all in-flight requests on unmount.
  useEffect(() => {
    mountedRef.current = true;
    const controls = jobControlRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(controls).forEach((c) => {
        if (c && c.stop) c.stop();
        if (c && c.abort) c.abort.abort();
      });
    };
  }, []);

  // Merge a partial update into one job by id (patch may be an object or fn).
  const patchJob = (id, patch) =>
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id ? { ...j, ...(typeof patch === "function" ? patch(j) : patch) } : j
      )
    );

  // Fold a status-poll response into the matching job's UI state.
  const applyStatus = (id, data) => {
    if (!data) return;
    const serverPct =
      typeof data.overall_progress === "number" ? data.overall_progress : 0;
    patchJob(id, (j) => ({
      status: data.status || "processing",
      apiJobId: data.job_id,
      videoId: data.video_id,
      currentStep: data.current_step,
      // Never let the bar jump backwards: the server can briefly report a lower
      // overall_progress right after a step boundary. Keep the high-water mark.
      progress: Math.max(j.progress || 0, serverPct),
      apiSteps: deriveSteps(data),
      statusMessage: data.status_message || null,
      result: data,
      error: data.status === "failed" ? data.error || "Processing failed" : null,
    }));
  };

  // Begin polling a job's status until it reaches a terminal state.
  const startPolling = (id, apiJobId) => {
    const existing = jobControlRef.current[id] || {};
    if (existing.stop) existing.stop();
    const stop = pollJobStatus(apiJobId, {
      onUpdate: (data) => {
        if (mountedRef.current) applyStatus(id, data);
      },
      onError: (err) => {
        if (mountedRef.current) patchJob(id, { pollError: err.message });
      },
    });
    jobControlRef.current[id] = { ...existing, stop };
  };

  const buildTitle = () => {
    let title = `${category} · ${mode === "clean" ? "Clean Mode" : "Cliffhanger Mode"}`;
    if (format === "highlight") {
      title = `${title} · Highlight Clips`;
    } else {
      const hasTopic = topic.trim();
      title = `${title} · Countdown Short${hasTopic ? ` — ${topic.trim()}` : ""}`;
    }
    return title;
  };

  // The subset of UI state the API mapping layer needs.
  const uiStateFor = (title) => ({
    title,
    duration,
    aspect,
    layoutStyle,
    subStyle,
    subSize,
    subPosition,
    language: "auto",
  });

  // Start Process: upload (if a file was chosen) -> create job -> poll.
  const submit = async () => {
    const chosenFile = file;
    const chosenLink = link.trim();
    if ((!chosenFile && !chosenLink) || busy || apiKeyMissing) return;

    const title = buildTitle();
    const id = Date.now();
    const job = {
      id,
      title,
      format,
      border,
      music,
      category,
      mode,
      link: chosenLink,
      topic: topic.trim(),
      duration,
      aspect,
      layoutStyle,
      subStyle,
      subSize,
      subPosition,
      sourceName: chosenFile ? chosenFile.name : chosenLink,
      status: chosenFile ? "uploading" : "creating",
      progress: 0,
      uploadProgress: 0,
      apiSteps: normaliseSteps([]),
      apiJobId: null,
      error: null,
      pollError: null,
    };

    setJobs((prev) => [...prev, job]);
    setPlayerJob(null);
    setFile(null); // consume the selection

    const abort = new AbortController();
    jobControlRef.current[id] = { abort };

    try {
      let videoId = null;
      let mediaMetadata = null;

      if (chosenFile) {
        const uploaded = await uploadFile(chosenFile, {
          signal: abort.signal,
          onProgress: (frac) => {
            if (!mountedRef.current) return;
            const pct = Math.round(frac * 100);
            // Uploading is the first of five steps -> ~15% of overall.
            patchJob(id, { uploadProgress: pct, progress: Math.round(pct * 0.15) });
          },
        });
        videoId = uploaded.video_id;
        mediaMetadata = await probeMediaMetadata(chosenFile);
      }

      if (!mountedRef.current) return;
      patchJob(id, { status: "creating" });

      const payload = buildCreateJobPayload(uiStateFor(title), {
        videoId,
        sourceUrl: videoId ? undefined : chosenLink,
        mediaMetadata,
      });
      const created = await createJob(payload, { signal: abort.signal });

      if (!mountedRef.current) return;
      patchJob(id, { apiJobId: created.job_id, status: "queued" });
      startPolling(id, created.job_id);
    } catch (err) {
      if (err && err.name === "AbortError") {
        patchJob(id, { status: "cancelled" });
      } else if (mountedRef.current) {
        patchJob(id, { status: "failed", error: err.message });
      }
    }
  };

  // Cancel: stop polling, abort any in-flight request, tell the server.
  const handleCancel = async (job) => {
    const ctrl = jobControlRef.current[job.id] || {};
    if (ctrl.stop) ctrl.stop();
    if (ctrl.abort) ctrl.abort.abort();
    patchJob(job.id, { status: "cancelled" });
    if (job.apiJobId) {
      try {
        await cancelJob(job.apiJobId);
      } catch {
        // best-effort — UI already reflects cancellation
      }
    }
  };

  // Retry a failed/cancelled job. Per the docs, retry may return the same
  // job_id (resume) or a new one (fresh job); we resume polling either way.
  const handleRetry = async (job) => {
    if (!job.apiJobId) {
      patchJob(job.id, {
        status: "failed",
        error: "Can't retry — the job was never created. Please start again.",
      });
      return;
    }
    const ctrl = jobControlRef.current[job.id] || {};
    if (ctrl.stop) ctrl.stop();
    patchJob(job.id, {
      status: "queued",
      progress: 0,
      error: null,
      pollError: null,
      apiSteps: normaliseSteps([]),
    });
    try {
      const res = await retryJob(job.apiJobId);
      if (!mountedRef.current) return;
      const newId = res.job_id;
      patchJob(job.id, { apiJobId: newId });
      startPolling(job.id, newId);
    } catch (err) {
      if (mountedRef.current) patchJob(job.id, { status: "failed", error: err.message });
    }
  };

  const selectedSong = MUSIC.find((s) => s === music) || MUSIC[0];

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "linear-gradient(135deg, #faf3e7 0%, #f3e3cc 45%, #ecd7b8 100%)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: COFFEE[900],
        padding: layout.isMobile ? "16px" : layout.isTablet ? "24px" : "32px",
      }}
    >
      <style>{`
        ${pulseKeyframes}
        ${downloadKeyframes}
        ${fadeInKeyframes}
        ${spinnerKeyframes}
        input:focus, textarea:focus, select:focus { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
        ::placeholder { color: #b49a7c; }
      `}</style>

      {/* ================= HEADER ================= */}
      <header
        style={{
          display: "flex",
          flexDirection: layout.isMobile ? "column" : "row",
          alignItems: layout.isMobile ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: layout.isMobile ? 26 : 32,
              fontWeight: 800,
              color: COFFEE[900],
              letterSpacing: "-0.02em",
            }}
          >
            YT Automator
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 14,
              color: COFFEE[600],
            }}
          >
            Turn any video into narrated highlight clips and countdown shorts.
          </p>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            color: COFFEE[700],
            background: CREAM_CARD,
            border: "1px solid #e8d9c0",
            borderRadius: 999,
            padding: "6px 14px",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: busy ? "#d9803e" : "#4e9d5a",
            }}
          />
          {busy ? "Processing…" : "System ready"}
        </span>
      </header>

      {apiKeyMissing && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            background: "#fbecd6",
            border: "1px solid #e6b877",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 20,
            color: "#7a4a17",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <span>
            No API key detected. Copy <code>.env.example</code> to <code>.env</code>, set{" "}
            <code>VITE_EXCIDO_API_KEY</code>, then restart <code>npm run dev</code>. Processing
            is disabled until a key is present.
          </span>
        </div>
      )}

      {/* ============ 1. VIDEO INGESTION ============ */}
      <section
        className="card"
        style={{
          background: CREAM_CARD,
          border: "1px solid #eadbc2",
          borderRadius: 16,
          padding: layout.isMobile ? 16 : 24,
          marginBottom: 20,
          boxShadow: "0 6px 18px rgba(107, 66, 38, 0.08)",
        }}
      >
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 18,
            fontWeight: 700,
            color: COFFEE[800],
          }}
        >
          1 · Video Ingestion
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: COFFEE[600] }}>
          Paste the link to the movie or show you want to process.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: layout.isMobile
              ? "1fr"
              : layout.isTablet
              ? "1fr 1fr"
              : "1fr 240px",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste video link (YouTube, Vimeo, direct file…)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 14px",
              fontSize: 14,
              borderRadius: 10,
              border: "1px solid #e0cdaf",
              background: "#fffdf8",
              color: COFFEE[900],
            }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 14,
              borderRadius: 10,
              border: "1px solid #e0cdaf",
              background: "#fffdf8",
              color: COFFEE[900],
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* File upload — optional alternative to the link above */}
        <div style={{ marginBottom: 14 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COFFEE[700],
              marginBottom: 8,
              display: "block",
            }}
          >
            …or upload a video file
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label
              style={{
                cursor: "pointer",
                padding: "10px 16px",
                borderRadius: 10,
                border: `2px dashed ${COFFEE[400]}`,
                background: "#fffdf8",
                color: COFFEE[700],
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Choose file
              <input
                type="file"
                accept="video/*,audio/*"
                style={{ display: "none" }}
                onChange={(e) =>
                  setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)
                }
              />
            </label>
            {file ? (
              <span
                style={{
                  fontSize: 13,
                  color: COFFEE[800],
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                <button
                  onClick={() => setFile(null)}
                  aria-label="Remove file"
                  style={{
                    cursor: "pointer",
                    border: "none",
                    background: "transparent",
                    color: ACCENT,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  ✕
                </button>
              </span>
            ) : (
              <span style={{ fontSize: 12, color: COFFEE[500] }}>
                Uploaded in 5 MB chunks. Takes priority over the link when set.
              </span>
            )}
          </div>
        </div>

        <div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: COFFEE[700],
              marginBottom: 8,
              display: "block",
            }}
          >
            Slice Mode
          </span>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {[
              { id: "clean", label: "Clean Mode", desc: "Standard slicing of scenes" },
              {
                id: "cliffhanger",
                label: "Cliffhanger Mode",
                desc: "Slice at moments of high tension or suspense",
              },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                style={{
                  flex: "1 1 0",
                  minWidth: layout.isMobile ? "100%" : 170,
                  cursor: "pointer",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: `2px solid ${mode === m.id ? COFFEE[700] : "#e0cdaf"}`,
                  background: mode === m.id ? "#f1e2cd" : "transparent",
                  color: mode === m.id ? COFFEE[800] : COFFEE[600],
                  fontFamily: "inherit",
                  textAlign: "left",
                }}
              >
                <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>
                  {m.label}
                </span>
                <span style={{ display: "block", fontSize: 12, marginTop: 2 }}>
                  {m.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ============ 2. CLIP SETTINGS ============ */}
      <section
        style={{
          background: CREAM_CARD,
          border: "1px solid #eadbc2",
          borderRadius: 16,
          padding: layout.isMobile ? 16 : 24,
          marginBottom: 20,
          boxShadow: "0 6px 18px rgba(107, 66, 38, 0.08)",
        }}
      >
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 18,
            fontWeight: 700,
            color: COFFEE[800],
          }}
        >
          2 · Clip Settings
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: COFFEE[600] }}>
          Control how each clip is cut, framed, and captioned.
        </p>

        <SettingGroup
          label="Clip Duration"
          value={duration}
          onChange={setDuration}
          options={DURATIONS}
        />
        <SettingGroup
          label="Target Aspect Ratio"
          value={aspect}
          onChange={setAspect}
          options={ASPECTS}
        />
        <LayoutStylePicker value={layoutStyle} onChange={setLayoutStyle} />
        <SubtitlePresetPicker value={subStyle} onChange={setSubStyle} />
        <SettingGroup
          label="Subtitle Size"
          value={subSize}
          onChange={setSubSize}
          options={SUB_SIZES}
        />
        <SubtitlePositionGrid value={subPosition} onChange={setSubPosition} />
      </section>

      {/* ============ 3. OUTPUT FORMAT ============ */}
      <section
        style={{
          background: CREAM_CARD,
          border: "1px solid #eadbc2",
          borderRadius: 16,
          padding: layout.isMobile ? 16 : 24,
          marginBottom: 20,
          boxShadow: "0 6px 18px rgba(107, 66, 38, 0.08)",
        }}
      >
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: 18,
            fontWeight: 700,
            color: COFFEE[800],
          }}
        >
          3 · Output Format
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: COFFEE[600] }}>
          Choose the end result you want to generate.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: layout.isMobile ? "1fr" : "1fr 1fr",
            gap: 14,
          }}
        >
          <button
            onClick={() => setFormat("highlight")}
            aria-pressed={format === "highlight"}
            style={{
              cursor: "pointer",
              textAlign: "left",
              padding: 16,
              borderRadius: 14,
              border: `2px solid ${format === "highlight" ? COFFEE[700] : "#e0cdaf"}`,
              background: format === "highlight" ? "#f1e2cd" : "transparent",
              fontFamily: "inherit",
              color: COFFEE[800],
            }}
          >
            <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>
              Option A — Highlight Clips
            </span>
            <span
              style={{
                display: "block",
                fontSize: 13,
                margin: "6px 0 12px",
                color: COFFEE[600],
              }}
            >
              Individual highlight clips, fully customizable.
            </span>

            <span
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: COFFEE[700],
              }}
            >
              Border color
            </span>
            <div
              style={{ display: "flex", gap: 8, marginBottom: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              {BORDERS.map((c) => (
                <button
                  key={c}
                  aria-label={`Border color ${c}`}
                  onClick={() => setBorder(c)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: c,
                    border:
                      border === c
                        ? "2px solid " + COFFEE[900]
                        : "2px solid rgba(75,46,29,0.15)",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>

            <label
              htmlFor="music-select"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: COFFEE[700],
              }}
            >
              Background music
            </label>
            <select
              id="music-select"
              value={music}
              onChange={(e) => setMusic(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                borderRadius: 10,
                border: "1px solid #e0cdaf",
                background: "#fffdf8",
                color: COFFEE[900],
              }}
            >
              {MUSIC.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </button>

          <button
            onClick={() => setFormat("countdown")}
            aria-pressed={format === "countdown"}
            style={{
              cursor: "pointer",
              textAlign: "left",
              padding: 16,
              borderRadius: 14,
              border: `2px solid ${format === "countdown" ? COFFEE[700] : "#e0cdaf"}`,
              background: format === "countdown" ? "#f1e2cd" : "transparent",
              fontFamily: "inherit",
              color: COFFEE[800],
            }}
          >
            <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>
              Option B — Countdown Short
            </span>
            <span
              style={{
                display: "block",
                fontSize: 13,
                margin: "6px 0 12px",
                color: COFFEE[600],
              }}
            >
              Vertical short counting down the best scenes (3 → 2 → 1).
            </span>

            {format === "countdown" && (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
                onClick={(e) => e.stopPropagation()}
              >
                <label
                  htmlFor="topic-input"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: COFFEE[700],
                  }}
                >
                  Countdown Topic
                </label>
                <input
                  id="topic-input"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder='e.g. "top 3 action scenes"'
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 12px",
                    fontSize: 13,
                    borderRadius: 10,
                    border: "1px solid #e0cdaf",
                    background: "#fffdf8",
                    color: COFFEE[900],
                  }}
                />
              </div>
            )}
          </button>
        </div>
      </section>

      {/* ============ START BUTTON ============ */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, margin: "28px 0" }}>
        {(() => {
          const canStart = !busy && !apiKeyMissing && (link.trim() || file);
          return (
            <button
              onClick={submit}
              disabled={!canStart}
              style={{
                cursor: canStart ? "pointer" : "not-allowed",
                opacity: canStart ? 1 : 0.55,
                padding: "14px 36px",
                fontSize: 16,
                fontWeight: 700,
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg, #8a5a33, #6b4226)",
                color: CREAM,
                boxShadow: "0 8px 20px rgba(107, 66, 38, 0.3)",
                fontFamily: "inherit",
              }}
            >
              {busy ? "Processing…" : file ? "Upload & Process" : "Start Process"}
            </button>
          );
        })()}
        {!busy && !apiKeyMissing && !link.trim() && !file && (
          <span style={{ fontSize: 12, color: COFFEE[500] }}>
            Paste a video link or choose a file to begin.
          </span>
        )}
      </div>

      {/* ============ 4. PROCESSING DASHBOARD ============ */}
      {jobs.length > 0 && (
        <section
          style={{
            background: "rgba(253, 248, 239, 0.9)",
            border: "1px solid #eadbc2",
            borderRadius: 16,
            padding: layout.isMobile ? 16 : 24,
            boxShadow: "0 6px 18px rgba(107, 66, 38, 0.08)",
          }}
        >
          <h2
            style={{
              margin: "0 0 16px",
              fontSize: 18,
              fontWeight: 700,
              color: COFFEE[800],
            }}
          >
            4 · Processing Dashboard
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {jobs.map((job) => (
              <div key={job.id}>
                {job.status === "completed" ? (
                  <ResultCard
                    job={job}
                    song={job.music || selectedSong}
                    onReplay={() => setPlayerJob(job)}
                  />
                ) : job.status === "failed" || job.status === "cancelled" ? (
                  <FailedCard job={job} onRetry={() => handleRetry(job)} />
                ) : (
                  <JobRow
                    job={job}
                    isMobile={layout.isMobile}
                    onCancel={() => handleCancel(job)}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {playerJob && (
        <Modal onClose={() => setPlayerJob(null)} layout={layout}>
          <PlayerCard job={playerJob} onClose={() => setPlayerJob(null)} />
        </Modal>
      )}
    </div>
  );
}

// ============================================================
//  Job row — shows a single job's live pipeline status
//  Driven entirely by the Excido status payload (job.apiSteps,
//  job.status, job.progress). Offers a Cancel action.
// ============================================================
const STATUS_LABEL = {
  uploading: "Uploading",
  creating: "Creating job",
  queued: "Queued",
  pending: "Queued",
  running: "Processing",
  processing: "Processing",
};

function JobRow({ job, isMobile, onCancel }) {
  // Prefer the server's per-step breakdown; before it arrives, fall back to
  // a fresh (all-pending) copy of the canonical step list.
  const steps = (job.apiSteps && job.apiSteps.length ? job.apiSteps : STEPS).map(
    (step) => ({
      id: step.id,
      label: step.label,
      state:
        step.status === "completed"
          ? "done"
          : step.status === "processing"
          ? "running"
          : "pending",
    })
  );

  const statusText = STATUS_LABEL[job.status] || "Working";
  const showUpload = job.status === "uploading";
  const pct = showUpload ? job.uploadProgress || 0 : job.progress || 0;

  return (
    <div
      style={{
        border: "1px solid #e5d4b9",
        borderRadius: 12,
        padding: "14px 16px",
        background: "#fffdf8",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: 14,
              color: COFFEE[800],
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {job.title}
          </p>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12,
              color: COFFEE[500],
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {job.sourceName || job.link}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: COFFEE[700],
              background: "#f3e6d2",
              padding: "3px 9px",
              borderRadius: 999,
              whiteSpace: "nowrap",
            }}
          >
            {statusText}
            {showUpload ? ` · ${pct}%` : ""}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: COFFEE[600],
              whiteSpace: "nowrap",
            }}
          >
            {pct}%
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              style={{
                cursor: "pointer",
                border: "1px solid #e0cdaf",
                background: "transparent",
                color: COFFEE[700],
                fontSize: 12,
                fontWeight: 700,
                padding: "5px 12px",
                borderRadius: 8,
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Overall progress bar */}
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "#f0e0c8",
          overflow: "hidden",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: "100%",
            background: "linear-gradient(90deg, #c68a55, #8a5a33)",
            transition: "width 0.4s ease",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 8 : 0,
        }}
      >
        {steps.map((step, i) => (
          <div
            key={step.id}
            style={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              gap: isMobile ? 8 : 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flex: 1,
                padding: isMobile ? "6px 10px" : "8px 6px",
                borderRadius: 8,
                background:
                  step.state === "running" ? "#f6e7d2" : "transparent",
                border:
                  step.state === "running"
                    ? "1px solid " + COFFEE[400]
                    : "1px solid transparent",
              }}
            >
              {step.state === "running" && (
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    border: "2px solid " + COFFEE[700],
                    borderTopColor: "transparent",
                    animation: "ytSpin 0.8s linear infinite",
                    flexShrink: 0,
                  }}
                />
              )}
              {step.state === "done" && (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="10" cy="10" r="9" fill="#4e9d5a" />
                  <path
                    d="M6 10.5 L9 13.5 L14 7.5"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {step.state === "pending" && (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    border: "2px solid #dcc9ab",
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: step.state === "running" ? 700 : 500,
                  color:
                    step.state === "running"
                      ? COFFEE[800]
                      : step.state === "done"
                      ? COFFEE[600]
                      : COFFEE[400],
                }}
              >
                {step.label}
              </span>
            </div>

            {!isMobile && i < steps.length - 1 && (
              <span
                style={{
                  width: 12,
                  height: 2,
                  background: step.state === "done" ? "#4e9d5a" : "#e0cdaf",
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {job.statusMessage && !job.pollError && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: COFFEE[600] }}>
          {job.statusMessage}
        </p>
      )}

      {job.pollError && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#a05a2c" }}>
          Status update hiccup: {job.pollError}. Still retrying…
        </p>
      )}
    </div>
  );
}

// ============================================================
//  Result card — appears after the pipeline finishes
// ============================================================
function ResultCard({ job, song, onReplay }) {
  const downloadUrl = findDownloadUrl(job.result);
  return (
    <div
      style={{
        animation: "ytFadeIn 0.5s ease-out",
        border: "1px solid #eadbc2",
        borderRadius: 14,
        padding: 16,
        background: "#fffdf8",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: COFFEE[800] }}>
            {job.title}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: COFFEE[600] }}>
            Ready — {job.format === "highlight" ? "Highlight Clips" : "Countdown Short"}
            {" · "}
            {job.aspect} · {labelOf(DURATIONS, job.duration)} · {labelOf(LAYOUTS, job.layoutStyle)}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: COFFEE[500] }}>
            Captions: {labelOf(SUBTITLE_STYLES, job.subStyle)} · {job.subSize} ·{" "}
            {labelOf(SUB_POSITION_GRID, job.subPosition)}
            {" · Music: "}
            {song}
          </p>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#4e9d5a",
            background: "#e9f5ea",
            padding: "4px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          ✓ Finished
        </span>
      </div>

      <div
        style={{
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          background: "#000",
          aspectRatio: (job.aspect || "16:9").replace(":", " / "),
          maxHeight: 340,
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <button
          onClick={onReplay}
          style={{
            cursor: "pointer",
            border: "none",
            background: "transparent",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            color: "#fff",
            fontFamily: "inherit",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            style={{
              filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.4))",
            }}
          >
            <circle cx="24" cy="24" r="22" fill="rgba(255,255,255,0.14)" />
            <path
              d="M20 16 L34 24 L20 32 Z"
              fill="#fff"
            />
          </svg>
          <span style={{ fontSize: 13, color: "#e8dcc9" }}>Preview</span>
        </button>
        <SubtitleOverlay
          style={job.subStyle}
          size={job.subSize}
          position={job.subPosition}
        />
      </div>

      <a
        href={downloadUrl || undefined}
        {...(downloadUrl ? { download: "", target: "_blank", rel: "noopener noreferrer" } : {})}
        onClick={(e) => {
          if (!downloadUrl) {
            e.preventDefault();
            alert(
              "The finished file URL wasn't included in the job status. Open the preview or check the Excido dashboard for the download."
            );
          }
        }}
        style={{
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          boxSizing: "border-box",
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: 700,
          borderRadius: 10,
          border: "none",
          background: "linear-gradient(135deg, #8a5a33, #6b4226)",
          color: CREAM,
          fontFamily: "inherit",
          textDecoration: "none",
          boxShadow: "0 4px 12px rgba(107, 66, 38, 0.25)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 20"
          fill="none"
          style={{ animation: "ytDownloadBounce 2s ease-in-out infinite" }}
        >
          <path
            d="M10 3 L10 13 M10 13 L6 9 M10 13 L14 9"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M3 16 L17 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        {downloadUrl ? "Download MP4" : "Download MP4 (link pending)"}
      </a>
    </div>
  );
}

// ============================================================
//  Failed / cancelled card — surfaces the error + a Retry action
// ============================================================
function FailedCard({ job, onRetry }) {
  const cancelled = job.status === "cancelled";
  return (
    <div
      style={{
        border: `1px solid ${cancelled ? "#e0cdaf" : "#e6b3a0"}`,
        borderRadius: 14,
        padding: 16,
        background: cancelled ? "#fdf8ef" : "#fdf1ec",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: job.error ? 8 : 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: 14,
              color: COFFEE[800],
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {job.title}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: COFFEE[500] }}>
            {job.sourceName || job.link}
          </p>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: cancelled ? COFFEE[600] : "#b23b1e",
            background: cancelled ? "#f1e2cd" : "#f7ddd3",
            padding: "4px 10px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {cancelled ? "Cancelled" : "Failed"}
        </span>
      </div>

      {job.error && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "#8a3a20", lineHeight: 1.5 }}>
          {job.error}
        </p>
      )}

      <button
        onClick={onRetry}
        style={{
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 18px",
          fontSize: 13,
          fontWeight: 700,
          borderRadius: 10,
          border: "none",
          background: "linear-gradient(135deg, #8a5a33, #6b4226)",
          color: CREAM,
          fontFamily: "inherit",
          boxShadow: "0 4px 12px rgba(107, 66, 38, 0.22)",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
          <path
            d="M4 10 a6 6 0 1 1 1.8 4.3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M4 5.5 L4 10 L8.5 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        Retry
      </button>
    </div>
  );
}

// ============================================================
//  Player modal — mock video player for the finished result
// ============================================================
function PlayerCard({ job, onClose }) {
  const videoUrl = findDownloadUrl(job.result);
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 640,
        borderRadius: 14,
        overflow: "hidden",
        background: "#000",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "#111",
        }}
      >
        <span style={{ color: "#f0e6d5", fontSize: 13, fontWeight: 700 }}>
          Your Generated Video
        </span>
        <button
          onClick={onClose}
          aria-label="Close preview"
          style={{
            cursor: "pointer",
            border: "none",
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            width: 28,
            height: 28,
            borderRadius: 999,
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          position: "relative",
          aspectRatio: (job.aspect || "16:9").replace(":", " / "),
          maxHeight: "60vh",
          background:
            "radial-gradient(circle at 30% 30%, #6b4226, #2a1708 70%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          color: "#fff",
        }}
      >
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            autoPlay
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          />
        ) : (
          <>
            <svg
              width="52"
              height="52"
              viewBox="0 0 48 48"
              fill="none"
              style={{ cursor: "pointer" }}
            >
              <circle cx="24" cy="24" r="22" fill="rgba(255,255,255,0.18)" />
              <path d="M20 16 L34 24 L20 32 Z" fill="#fff" />
            </svg>
            <p style={{ margin: 0, fontSize: 13, color: "#f0e6d5" }}>
              Preview unavailable — no playable URL in the job result yet.
            </p>
            <SubtitleOverlay
              style={job.subStyle}
              size={job.subSize}
              position={job.subPosition}
            />
          </>
        )}
      </div>

      {!videoUrl && (
        <div style={{ padding: "12px 16px", background: "#111" }}>
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: "rgba(255,255,255,0.15)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: "38%",
                height: "100%",
                background: "#d9803e",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontSize: 11,
              color: "#c9bda9",
            }}
          >
            <span>01:24</span>
            <span>03:42</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
//  Modal wrapper
// ============================================================
function Modal({ children, onClose, layout }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(43, 26, 12, 0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: layout.isMobile ? 12 : 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 640 }}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================
//  Setting group — a labelled row of single-select pill buttons
// ============================================================
function SettingGroup({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: COFFEE[700],
          marginBottom: 8,
          display: "block",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              style={{
                flex: "1 1 0",
                minWidth: 92,
                cursor: "pointer",
                padding: "10px 12px",
                borderRadius: 12,
                border: `2px solid ${active ? COFFEE[700] : "#e0cdaf"}`,
                background: active ? "#f1e2cd" : "transparent",
                color: active ? COFFEE[800] : COFFEE[600],
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
//  Layout Style picker — visual phone-frame preview cards
// ============================================================
function LayoutFrame({ kind }) {
  const frame = {
    position: "relative",
    width: "100%",
    maxWidth: 104,
    margin: "0 auto",
    aspectRatio: "9 / 16",
    borderRadius: 10,
    overflow: "hidden",
    border: "1px solid #e5d4b9",
  };
  const video = "linear-gradient(160deg, #e6c39d, #a97142)";

  if (kind === "glass") {
    return (
      <div style={{ ...frame, background: "linear-gradient(160deg, #c68a55, #6b4226)" }}>
        <div style={{ position: "absolute", top: "30%", bottom: "30%", left: 0, right: 0, background: video }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "30%", background: "rgba(247,236,221,0.38)", borderBottom: "1px solid rgba(255,255,255,0.4)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "30%", background: "rgba(247,236,221,0.38)", borderTop: "1px solid rgba(255,255,255,0.4)" }} />
      </div>
    );
  }
  if (kind === "fit") {
    return (
      <div style={{ ...frame, background: COFFEE[900] }}>
        <div style={{ position: "absolute", top: "27%", bottom: "27%", left: 0, right: 0, background: video }} />
      </div>
    );
  }
  if (kind === "stretched") {
    return (
      <div style={{ ...frame, background: video, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(75,46,29,0.55)" }}>
          STRETCHED
        </span>
      </div>
    );
  }
  // elongated
  return (
    <div style={{ ...frame, background: "#f0dcc3", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
      <div style={{ width: "100%", height: "100%", border: `1.5px dashed ${ACCENT}`, borderRadius: 6, background: "rgba(217,128,62,0.06)" }} />
    </div>
  );
}

function LayoutStylePicker({ value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COFFEE[700], display: "block" }}>
        Layout Style
      </span>
      <span style={{ fontSize: 12, color: COFFEE[500], margin: "2px 0 10px", display: "block" }}>
        Select the video framing layout for your clips.
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {LAYOUTS.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              style={{
                position: "relative",
                cursor: "pointer",
                padding: 12,
                borderRadius: 14,
                border: `2px solid ${active ? ACCENT : "#e0cdaf"}`,
                background: active ? "#fbf1e4" : "#fffdf8",
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: ACCENT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                    <path d="M5 10.5 L9 14 L15 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <LayoutFrame kind={o.value} />
              <span
                style={{
                  display: "block",
                  marginTop: 10,
                  fontSize: 13,
                  fontWeight: 700,
                  color: active ? COFFEE[800] : COFFEE[700],
                }}
              >
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
//  Subtitle Preset picker — stacked style preview cards
// ============================================================
function PresetSample({ kind }) {
  if (kind === "bold") {
    return (
      <span style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.01em", color: COFFEE[900] }}>
        Here is <span style={{ color: ACCENT }}>your</span> subtitle
      </span>
    );
  }
  if (kind === "neon") {
    return (
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "#fff",
          background: "#2a1708",
          padding: "6px 12px",
          borderRadius: 8,
          boxShadow: "0 0 10px rgba(217,128,62,0.55)",
        }}
      >
        Here is your subtitle
      </span>
    );
  }
  return (
    <span style={{ fontSize: 14, fontWeight: 600, color: COFFEE[900] }}>
      Here is your subtitle
    </span>
  );
}

function SubtitlePresetPicker({ value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COFFEE[700], display: "block" }}>
        Subtitle Preset
      </span>
      <span style={{ fontSize: 12, color: COFFEE[500], margin: "2px 0 10px", display: "block" }}>
        Choose how subtitles are displayed over your video.
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {SUBTITLE_STYLES.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              style={{
                cursor: "pointer",
                width: "100%",
                padding: 12,
                borderRadius: 14,
                border: `2px solid ${active ? ACCENT : "#e0cdaf"}`,
                background: active ? "#fbf1e4" : "#fffdf8",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  background: "#f2e6d4",
                  borderRadius: 10,
                  padding: "16px 12px",
                  minHeight: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                }}
              >
                <PresetSample kind={o.value} />
              </div>
              <span
                style={{
                  display: "block",
                  marginTop: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  color: active ? COFFEE[800] : COFFEE[700],
                }}
              >
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
//  Subtitle Position — 3×3 grid (beta: only Bottom-Centre active)
// ============================================================
function SubtitlePositionGrid({ value, onChange }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: COFFEE[700], display: "block" }}>
        Subtitle Position
      </span>
      <span style={{ fontSize: 12, color: COFFEE[500], margin: "2px 0 10px", display: "block" }}>
        Choose where subtitles are overlaid on your video output.
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {SUB_POSITION_GRID.map((cell) => {
          const selected = value === cell.value;
          return (
            <button
              key={cell.value}
              onClick={() => onChange(cell.value)}
              aria-pressed={selected}
              style={{
                cursor: "pointer",
                padding: "12px 6px",
                borderRadius: 10,
                border: `2px solid ${selected ? ACCENT : "#e6d6bd"}`,
                background: selected ? "#fbf1e4" : "#fdf8ef",
                color: selected ? ACCENT : COFFEE[700],
                fontFamily: "inherit",
                textAlign: "center",
              }}
            >
              <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>
                {cell.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
//  Subtitle overlay — sample caption shown on the result frame
// ============================================================
function SubtitleOverlay({ style, size, position }) {
  const fs = size === "small" ? 13 : size === "large" ? 24 : 17;
  const [vert, horiz] = String(position).split("-");
  const align =
    vert === "top" ? "flex-start" : vert === "mid" ? "center" : "flex-end";
  const justify =
    horiz === "left" ? "flex-start" : horiz === "right" ? "flex-end" : "center";
  const textAlign = horiz === "left" ? "left" : horiz === "right" ? "right" : "center";
  const pad = vert === "mid" ? "0 16px" : "18px 16px";

  let inner;
  if (style === "bold") {
    inner = (
      <span
        style={{
          fontWeight: 900,
          fontSize: fs + 2,
          color: "#fff",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          lineHeight: 1.15,
          textShadow: "0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        This <span style={{ color: ACCENT }}>changes</span> everything
      </span>
    );
  } else if (style === "neon") {
    inner = (
      <span
        style={{
          display: "inline-block",
          fontWeight: 700,
          fontSize: fs,
          color: "#fff",
          lineHeight: 1.2,
          background: "rgba(15, 8, 4, 0.72)",
          padding: "6px 14px",
          borderRadius: 10,
          border: "1px solid rgba(217,128,62,0.6)",
          boxShadow:
            "0 0 14px rgba(217,128,62,0.75), 0 0 4px rgba(217,128,62,0.9)",
        }}
      >
        This changes everything
      </span>
    );
  } else {
    inner = (
      <span
        style={{
          color: "#fff",
          fontWeight: 600,
          fontSize: fs,
          lineHeight: 1.2,
          textShadow: "0 2px 6px rgba(0,0,0,0.9)",
        }}
      >
        This changes everything
      </span>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: align,
        justifyContent: justify,
        padding: pad,
        textAlign: textAlign,
        pointerEvents: "none",
      }}
    >
      <div style={{ maxWidth: "84%" }}>{inner}</div>
    </div>
  );
}
