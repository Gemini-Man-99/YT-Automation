// ============================================================
//  Excido API client
//  Talks to the Excido video-processing API described in the
//  workflow docs (https://api.excido.app/docs):
//
//    Phase 1  Resumable media upload   /api/v1/media/upload/*
//    Phase 2  Job creation & dispatch  /api/v1/jobs/create
//    Phase 3  Status polling loop      /api/v1/jobs/:id/status
//    Phase 4  Job control              /api/v1/jobs/:id/cancel · /retry
//
//  Every endpoint returns an envelope: { success, data?, message? }.
//  Auth: X-API-Key (VITE_EXCIDO_API_KEY) + X-User-Email
//  (VITE_EXCIDO_USER_EMAIL), both required on every request.
//
//  This file is a plain ES module (no React) so its pure mapping
//  helpers can also be unit-tested under Node.
// ============================================================

// import.meta.env only exists under Vite; guard it so the module
// can also be imported by a plain Node test runner.
const ENV =
  (typeof import.meta !== "undefined" && import.meta.env) || {};

// In dev, point VITE_EXCIDO_API_BASE at the Vite proxy path ("/excido")
// to sidestep CORS. In prod, set it to the real origin.
export const API_BASE = (ENV.VITE_EXCIDO_API_BASE || "https://api.excido.app").replace(/\/$/, "");
export const API_KEY = ENV.VITE_EXCIDO_API_KEY || "";
// The API also requires the account email on every request (X-User-Email).
export const USER_EMAIL = ENV.VITE_EXCIDO_USER_EMAIL || "";

// Both credentials are required for any call to succeed, so the UI gate
// checks for both. (Name kept for back-compat with existing call sites.)
export const hasApiKey = () => Boolean(API_KEY && USER_EMAIL);

// 5 MB chunks, exactly as the docs specify (5 * 1024 * 1024).
export const CHUNK_SIZE = 5 * 1024 * 1024;

// ---- Mapping tables: UI value -> API enum ----------------------------------
// The dashboard UI predates the API and uses its own vocabulary, so we
// translate on the way out. Anything the API can't express is folded into
// the human-readable `title` instead (done by the caller).

export const DURATION_MAP = {
  auto: "60", // API has no "auto"; 60s is the sensible middle default
  under30: "30",
  "30-60": "60",
  "60-90": "90",
};

export const DIMENSION_MAP = {
  "16:9": "16:9",
  "9:16": "9:16",
  "1:1": "1:1",
  "4:5": "9:16", // API supports only 9:16 / 1:1 / 16:9 — 4:5 -> nearest vertical
};

export const EFFECT_MAP = {
  glass: "glassmorphism",
  fit: "full",
  stretched: "full",
  elongated: "split",
};

export const SUBTITLE_STYLE_MAP = {
  standard: "standard",
  bold: "highlight",
  neon: "karaoke",
};

export const SUBTITLE_SIZE_MAP = {
  small: 40,
  medium: 60,
  large: 80,
};

// The API only accepts the centre column; collapse any horizontal choice
// to its vertical band's centre variant.
export const SUBTITLE_POSITION_MAP = {
  "top-left": "top-centre",
  "top-centre": "top-centre",
  "top-right": "top-centre",
  "mid-left": "mid-centre",
  "mid-centre": "mid-centre",
  "mid-right": "mid-centre",
  "bot-left": "bot-centre",
  "bot-centre": "bot-centre",
  "bot-right": "bot-centre",
};

// The UI doesn't collect these two required subtitle fields, so we default them.
export const DEFAULT_SUBTITLE_COLOR = "#FFFFFF";
export const DEFAULT_SUBTITLE_FONT = "Oswald";
export const DEFAULT_LANGUAGE = "auto";

// ---- Pipeline steps --------------------------------------------------------
// The API's canonical step order (from the status payload) with friendlier
// labels for the dashboard. Keep this order in sync with the server.
export const API_STEPS = [
  { id: "uploading", label: "Uploading / Verifying" },
  { id: "generating_clips", label: "Finding Highlights" },
  { id: "transcribing", label: "Transcribing" },
  { id: "generating_metadata", label: "Generating Metadata" },
  { id: "encoding_video", label: "Encoding & Subtitles" },
];

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

// ---- Pure helpers (unit-tested) --------------------------------------------

/** Number of 5 MB chunks a file of `fileSize` bytes is split into. */
export function chunkCount(fileSize) {
  return Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
}

/** Build the `subtitle` object for /api/v1/jobs/create from UI state. */
export function buildSubtitle(ui) {
  return {
    style: SUBTITLE_STYLE_MAP[ui.subStyle] || "standard",
    color: ui.subColor || DEFAULT_SUBTITLE_COLOR,
    font: ui.subFont || DEFAULT_SUBTITLE_FONT,
    size: SUBTITLE_SIZE_MAP[ui.subSize] || 60,
    position: SUBTITLE_POSITION_MAP[ui.subPosition] || "bot-centre",
  };
}

/**
 * Build the full /api/v1/jobs/create payload from UI state plus a source.
 * Provide EITHER `videoId` (after an upload) OR `sourceUrl` (URL mode).
 */
export function buildCreateJobPayload(ui, { videoId, sourceUrl, mediaMetadata } = {}) {
  const payload = {
    title: ui.title,
    language: ui.language || DEFAULT_LANGUAGE,
    desired_duration: DURATION_MAP[ui.duration] || "60",
    dimension: DIMENSION_MAP[ui.aspect] || "9:16",
    effect: EFFECT_MAP[ui.layoutStyle] || "full",
    max_clips: ui.maxClips ?? null,
    media_metadata: mediaMetadata ?? null,
    subtitle: buildSubtitle(ui),
  };
  if (videoId) payload.video_id = videoId;
  else if (sourceUrl) payload.source_url = sourceUrl;
  return payload;
}

/**
 * Read a video file's real duration/width/height in the browser. The API
 * requires all of { duration, width, height, size } inside media_metadata
 * whenever that object is present, so we probe the file before job creation.
 * Returns null for audio files and anything the browser can't decode — null
 * is a valid value for the (optional) field, so job creation never blocks on
 * it. Browser-only (uses <video> + object URLs); never called under Node.
 */
export function probeMediaMetadata(file) {
  return new Promise((resolve) => {
    try {
      if (!file || !/^video\//i.test(file.type || "")) {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(result);
      };
      video.onloadedmetadata = () => {
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
        finish(width && height ? { duration, width, height, size: file.size } : null);
      };
      video.onerror = () => finish(null);
      setTimeout(() => finish(null), 8000); // never hang job creation on a probe
      video.src = url;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Normalise a status payload's `steps` array into the fixed API_STEPS order,
 * so the UI can render a stable 5-step row regardless of what the server sends.
 * Returns [{ id, label, status: "pending"|"processing"|"completed", progress }].
 */
export function normaliseSteps(steps) {
  const byId = {};
  (steps || []).forEach((s) => {
    if (s && s.step) byId[s.step] = s;
  });
  return API_STEPS.map((meta) => {
    const match = byId[meta.id] || {};
    return {
      id: meta.id,
      label: meta.label,
      status: match.status || "pending",
      progress: typeof match.progress === "number" ? match.progress : 0,
    };
  });
}

/**
 * Derive the fixed 5-step UI breakdown from a status payload.
 *
 * The live API does NOT send a per-step array — it reports progress with flat
 * fields: `status`, `current_step`, and `step_progress`. So we infer each
 * step's state from where `current_step` sits in the canonical API_STEPS order:
 *   • steps before the current one -> completed
 *   • the current step             -> processing (carries step_progress)
 *   • steps after it               -> pending
 * A terminal "completed" status marks every step done; an unknown or absent
 * current step (e.g. freshly queued) leaves them all pending. This returns the
 * same shape as normaliseSteps so the existing renderers are unchanged.
 */
export function deriveSteps(data) {
  const status = data && data.status;
  if (status === "completed") {
    return API_STEPS.map((m) => ({ id: m.id, label: m.label, status: "completed", progress: 100 }));
  }
  const currentId = data && data.current_step;
  const stepProgress =
    data && typeof data.step_progress === "number" ? data.step_progress : 0;
  const idx = API_STEPS.findIndex((m) => m.id === currentId);
  return API_STEPS.map((m, i) => {
    if (idx === -1) return { id: m.id, label: m.label, status: "pending", progress: 0 };
    if (i < idx) return { id: m.id, label: m.label, status: "completed", progress: 100 };
    if (i === idx) return { id: m.id, label: m.label, status: "processing", progress: stepProgress };
    return { id: m.id, label: m.label, status: "pending", progress: 0 };
  });
}

// ---- HTTP core -------------------------------------------------------------

function authHeaders(extra = {}) {
  const h = { ...extra };
  // Excido authenticates with an API-key header plus the account email —
  // NOT an Authorization: Bearer token.
  if (API_KEY) h["X-API-Key"] = API_KEY;
  if (USER_EMAIL) h["X-User-Email"] = USER_EMAIL;
  return h;
}

/**
 * Low-level request. Throws an Error (with .status and .body) on HTTP failure
 * or when the API envelope reports { success: false }. Returns the parsed body.
 */
async function request(path, { method = "GET", json, form, signal } = {}) {
  const headers = authHeaders();
  let body;
  if (form) {
    body = form; // browser sets multipart boundary; do NOT set Content-Type
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body, signal });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new Error(`Network error calling ${path}: ${err.message}`);
  }

  let parsed = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!res.ok || (parsed && parsed.success === false)) {
    const msg =
      (parsed && (parsed.message || parsed.error)) ||
      `Request to ${path} failed (${res.status} ${res.statusText})`;
    const error = new Error(msg);
    error.status = res.status;
    error.body = parsed;
    throw error;
  }
  return parsed || {};
}

// ---- Phase 1: Resumable media upload ---------------------------------------

export function initUpload({ filename, fileSize, totalChunks, mimeType }, opts = {}) {
  return request("/api/v1/media/upload/init", {
    method: "POST",
    json: {
      filename,
      file_size: fileSize,
      total_chunks: totalChunks,
      mime_type: mimeType,
    },
    signal: opts.signal,
  }).then((b) => b.data);
}

export function getUploadStatus(uploadId, opts = {}) {
  return request(
    `/api/v1/media/upload/status?upload_id=${encodeURIComponent(uploadId)}`,
    { signal: opts.signal }
  ).then((b) => b.data);
}

export function uploadChunk({ uploadId, chunkIndex, chunk }, opts = {}) {
  const form = new FormData();
  form.append("upload_id", uploadId);
  form.append("chunk_index", String(chunkIndex));
  form.append("chunk", chunk);
  return request("/api/v1/media/upload/chunk", {
    method: "POST",
    form,
    signal: opts.signal,
  });
}

export function completeUpload(uploadId, opts = {}) {
  return request("/api/v1/media/upload/complete", {
    method: "POST",
    json: { upload_id: uploadId },
    signal: opts.signal,
  }).then((b) => b.data);
}

/**
 * Upload a whole File through the resumable flow: init -> (resume-aware)
 * chunk loop -> complete. Calls onProgress(fraction 0..1) as chunks land.
 * Returns { video_id, filename, file_size }.
 */
export async function uploadFile(file, { onProgress, signal } = {}) {
  const totalChunks = chunkCount(file.size);
  const init = await initUpload(
    {
      filename: file.name,
      fileSize: file.size,
      totalChunks,
      mimeType: file.type || "application/octet-stream",
    },
    { signal }
  );
  const uploadId = init.upload_id;

  // Resume support: skip chunks the server already has.
  let alreadyDone = new Set();
  try {
    const status = await getUploadStatus(uploadId, { signal });
    if (status && Array.isArray(status.uploaded_chunks)) {
      alreadyDone = new Set(status.uploaded_chunks);
    }
  } catch {
    // status is best-effort; ignore and upload everything
  }

  let completed = alreadyDone.size;
  if (onProgress) onProgress(totalChunks ? completed / totalChunks : 0);

  for (let i = 0; i < totalChunks; i++) {
    if (signal && signal.aborted) {
      const e = new Error("Upload cancelled");
      e.name = "AbortError";
      throw e;
    }
    if (alreadyDone.has(i)) continue;
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    await uploadChunk({ uploadId, chunkIndex: i, chunk }, { signal });
    completed++;
    if (onProgress) onProgress(totalChunks ? completed / totalChunks : 1);
  }

  return completeUpload(uploadId, { signal });
}

// ---- Phase 2: Job creation -------------------------------------------------

export function createJob(payload, opts = {}) {
  return request("/api/v1/jobs/create", {
    method: "POST",
    json: payload,
    signal: opts.signal,
  }).then((b) => b.data);
}

// ---- Phase 3: Status ------------------------------------------------------

export function getJobStatus(jobId, opts = {}) {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/status`, {
    signal: opts.signal,
  }).then((b) => b.data);
}

/**
 * Poll a job until it reaches a terminal state. Calls onUpdate(data) after
 * every successful poll and onError(err) if a poll throws. Returns a stop()
 * function that halts polling immediately.
 */
export function pollJobStatus(jobId, { onUpdate, onError, intervalMs = 5000 } = {}) {
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const data = await getJobStatus(jobId);
      if (stopped) return;
      if (onUpdate) onUpdate(data);
      if (data && isTerminal(data.status)) return; // done — stop polling
    } catch (err) {
      if (stopped) return;
      if (onError) onError(err);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();

  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// ---- Phase 4: Job control --------------------------------------------------

export function cancelJob(jobId, opts = {}) {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    json: {},
    signal: opts.signal,
  });
}

export function retryJob(jobId, opts = {}) {
  return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
    json: {},
    signal: opts.signal,
  }).then((b) => b.data); // { job_id } — may be same or new
}
