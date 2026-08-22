// ============================================================
//  Pure-function self-test for the Excido client.
//  Runs under plain Node (no browser, no network) because the
//  helpers under test are pure. Run with:  node excido.selftest.mjs
//
//  These cover the risky UI->API mapping + math, which is where
//  a wrong enum or off-by-one would silently break real jobs.
// ============================================================
import assert from "node:assert/strict";
import {
  CHUNK_SIZE,
  chunkCount,
  buildSubtitle,
  buildCreateJobPayload,
  normaliseSteps,
  isTerminal,
  API_STEPS,
} from "./src/api/excido.js";

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

console.log("Excido client self-test\n");

// ---- chunkCount: 5 MB chunk math (resumable upload) ----
check("CHUNK_SIZE is exactly 5 MB", () => {
  assert.equal(CHUNK_SIZE, 5 * 1024 * 1024);
});
check("chunkCount handles empty + boundary + overflow", () => {
  assert.equal(chunkCount(0), 1);                    // never zero chunks
  assert.equal(chunkCount(CHUNK_SIZE), 1);           // exactly one full chunk
  assert.equal(chunkCount(CHUNK_SIZE + 1), 2);       // one byte over -> two
  assert.equal(chunkCount(5 * CHUNK_SIZE), 5);       // exact multiple
  assert.equal(chunkCount(12 * 1024 * 1024), 3);     // 12 MB -> 3 chunks
});

// ---- buildSubtitle: UI vocab -> API subtitle object ----
check("buildSubtitle maps style/size/position enums", () => {
  const s = buildSubtitle({ subStyle: "bold", subSize: "large", subPosition: "top-right" });
  assert.equal(s.style, "highlight");
  assert.equal(s.size, 80);
  assert.equal(s.position, "top-centre"); // horizontal collapses to centre
  assert.equal(s.color, "#FFFFFF");       // defaulted (UI doesn't collect it)
  assert.equal(s.font, "Oswald");         // defaulted
});
check("buildSubtitle falls back for unknown values", () => {
  const s = buildSubtitle({ subStyle: "???", subSize: "???", subPosition: "???" });
  assert.equal(s.style, "standard");
  assert.equal(s.size, 60);
  assert.equal(s.position, "bot-centre");
});

// ---- buildCreateJobPayload: full job body ----
check("payload maps duration/dimension/effect + nests subtitle", () => {
  const ui = {
    title: "Movie · Clean Mode · Highlight Clips",
    duration: "30-60", aspect: "4:5", layoutStyle: "glass",
    subStyle: "neon", subSize: "small", subPosition: "mid-right",
    language: "auto",
  };
  const p = buildCreateJobPayload(ui, { sourceUrl: "https://x.test/v.mp4" });
  assert.equal(p.title, ui.title);
  assert.equal(p.language, "auto");
  assert.equal(p.desired_duration, "60"); // "30-60" -> "60"
  assert.equal(p.dimension, "9:16");      // "4:5" -> nearest vertical
  assert.equal(p.effect, "glassmorphism");
  assert.equal(p.subtitle.style, "karaoke"); // neon -> karaoke
  assert.equal(p.subtitle.size, 40);         // small -> 40
  assert.equal(p.max_clips, null);
  assert.equal(p.media_metadata, null);
});
check("payload uses source_url XOR video_id", () => {
  const ui = { title: "t", duration: "auto", aspect: "16:9", layoutStyle: "fit", subStyle: "standard", subSize: "medium", subPosition: "bot-centre" };
  const urlMode = buildCreateJobPayload(ui, { sourceUrl: "https://x.test/v.mp4" });
  assert.equal(urlMode.source_url, "https://x.test/v.mp4");
  assert.equal("video_id" in urlMode, false);

  const uploadMode = buildCreateJobPayload(ui, { videoId: "vid_123", mediaMetadata: { size: 42 } });
  assert.equal(uploadMode.video_id, "vid_123");
  assert.equal("source_url" in uploadMode, false);
  assert.deepEqual(uploadMode.media_metadata, { size: 42 });

  // videoId wins when both are (accidentally) supplied
  const both = buildCreateJobPayload(ui, { videoId: "vid_9", sourceUrl: "https://x.test/v.mp4" });
  assert.equal(both.video_id, "vid_9");
  assert.equal("source_url" in both, false);
});
check("payload defaults duration/dimension/effect when unknown", () => {
  const p = buildCreateJobPayload({ title: "t" }, { sourceUrl: "https://x.test" });
  assert.equal(p.desired_duration, "60");
  assert.equal(p.dimension, "9:16");
  assert.equal(p.effect, "full");
});

// ---- normaliseSteps: server steps -> fixed 5-step order ----
check("normaliseSteps returns the 5 canonical steps in order", () => {
  const out = normaliseSteps([
    { step: "transcribing", status: "processing", progress: 40 },
    { step: "uploading", status: "completed", progress: 100 },
  ]);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((s) => s.id), API_STEPS.map((s) => s.id));
  assert.equal(out[0].status, "completed"); // uploading
  assert.equal(out[0].progress, 100);
  assert.equal(out[1].status, "pending");   // generating_clips (absent)
  assert.equal(out[2].status, "processing");// transcribing
  assert.equal(out[2].progress, 40);
});
check("normaliseSteps tolerates empty / missing input", () => {
  for (const input of [undefined, null, []]) {
    const out = normaliseSteps(input);
    assert.equal(out.length, 5);
    assert.ok(out.every((s) => s.status === "pending" && s.progress === 0));
  }
});

// ---- isTerminal ----
check("isTerminal identifies terminal vs active states", () => {
  for (const s of ["completed", "failed", "cancelled"]) assert.equal(isTerminal(s), true);
  for (const s of ["queued", "processing", "uploading", "creating"]) assert.equal(isTerminal(s), false);
});

console.log("\nAll " + passed + " checks passed.");
