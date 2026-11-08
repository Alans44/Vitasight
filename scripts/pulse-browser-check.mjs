import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "vitasight-pulse-"));
const posePort = process.env.PULSE_TEST_POSE_PORT || "18999";
const url = "http://127.0.0.1:18792";
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: "18792",
    DATA_PATH: join(data, "test.sqlite"),
    POSE_PORT: posePort,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  browser;
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      ready = (await fetch(url + "/api/state")).ok;
      if (ready) break;
    } catch {}
    if (server.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (
      !r.url().startsWith(url) &&
      !r.url().startsWith("data:") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 2,
  );
  const bpm = await page.getByTestId("pulse-bpm").allTextContents();
  const sceneBpm = await page
    .locator(".pulse-card")
    .evaluateAll((cards) =>
      cards.map((card) => Number(card.getAttribute("data-displayed-bpm"))),
    );
  assert.ok(Math.abs(sceneBpm[0] - 72) <= 2);
  assert.ok(Math.abs(sceneBpm[1] - 86) <= 2);
  assert.equal(await page.locator(".face-mesh").count(), 2);
  const tabs = page.getByRole("navigation", { name: "Workspace tabs" });
  const sceneCard = page.locator(".source-card").first();
  const bpmOverlay = sceneCard.getByRole("button", {
    name: "BPM overlay",
    exact: true,
  });
  const bodyLandmarks = sceneCard.getByRole("button", {
    name: "Body landmarks",
    exact: true,
  });
  assert.equal(await bpmOverlay.getAttribute("aria-pressed"), "true");
  assert.equal(await bodyLandmarks.getAttribute("aria-pressed"), "true");
  await bpmOverlay.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card").length === 0,
  );
  assert.equal(await bpmOverlay.getAttribute("aria-pressed"), "false");
  assert.equal(await sceneCard.locator(".pose-overlay").isVisible(), true);
  assert.equal(await page.locator(".face-mesh").count(), 2);
  await tabs.getByRole("button", { name: "Library", exact: true }).click();
  const library = page.getByRole("region", { name: "Video library" });
  await library
    .getByRole("img", { name: "Waiting room 01, no video loaded" })
    .waitFor();
  assert.equal(
    await library.getByText("No video loaded", { exact: true }).isVisible(),
    true,
  );
  await page.screenshot({
    path: "test-results/vitasight-library.png",
    fullPage: true,
  });
  await tabs.getByRole("button", { name: "Dashboard", exact: true }).click();
  assert.equal(await bpmOverlay.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".pulse-card").count(), 0);
  await page.waitForFunction(
    () => document.querySelectorAll(".face-mesh").length === 2,
  );
  assert.equal(await page.locator(".face-mesh").count(), 2);
  await bpmOverlay.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 2,
  );
  await bodyLandmarks.click();
  await page.waitForFunction(
    () => document.querySelector(".pose-overlay") === null,
  );
  assert.equal(await bodyLandmarks.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".pulse-card.locked").count(), 2);
  const isDemoFrame = (response) =>
    response.url().startsWith(url + "/api/sources/") &&
    response.url().endsWith("/demo") &&
    response.request().method() === "POST" &&
    response.ok();
  await page.waitForResponse(isDemoFrame);
  await page.waitForResponse(isDemoFrame);
  assert.equal(await page.locator(".pulse-card.locked").count(), 2);
  await tabs.getByRole("button", { name: "Direct Feed", exact: true }).click();
  await page.waitForResponse(isDemoFrame);
  await page.waitForResponse(isDemoFrame);
  assert.equal(
    await page.locator(".monitor-layout.direct-feed").isVisible(),
    true,
  );
  assert.equal(
    await tabs
      .getByRole("button", { name: "Direct Feed", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  await tabs.getByRole("button", { name: "Dashboard", exact: true }).click();
  assert.equal(await bodyLandmarks.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".pose-overlay").count(), 0);
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 2,
  );
  await bodyLandmarks.click();
  await page.waitForFunction(
    () => document.querySelectorAll(".face-mesh").length === 2,
  );
  assert.equal(await bodyLandmarks.getAttribute("aria-pressed"), "true");
  await page.screenshot({
    path: "test-results/pulse-demo.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await tabs.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 2,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/pulse-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: /Stop Scene lab/ }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });

  await mkdir("test-results", { recursive: true });
  if (!existsSync("test-results/portrait.jpg")) {
    const image = await fetch(
      "https://storage.googleapis.com/mediapipe-assets/portrait.jpg",
    );
    if (!image.ok)
      throw Error("Could not download the public face test fixture");
    await writeFile(
      "test-results/portrait.jpg",
      Buffer.from(await image.arrayBuffer()),
    );
  }
  const portrait = await readFile("test-results/portrait.jpg");
  assert.equal(
    createHash("sha256").update(portrait).digest("hex"),
    "a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e",
    "Unexpected face fixture contents",
  );
  await page.route("**/fixture.jpg", (route) =>
    route.fulfill({ contentType: "image/jpeg", body: portrait }),
  );
  if (!process.env.PULSE_TEST_POSE_PORT) {
    await page.route("**/api/vision", (route) =>
      route.fulfill({ json: { ready: true, engine: "fixture" } }),
    );
    await page.route("**/api/sources/*/frame", (route) =>
      route.fulfill({ json: { ok: true } }),
    );
  }
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = "/fixture.jpg";
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#142a2a";
      ctx.fillRect(0, 0, 640, 360);
      const width = (360 * image.width) / image.height;
      ctx.drawImage(image, (640 - width) / 2, 0, width, 360);
      const base = ctx.getImageData(0, 0, 640, 360),
        output = ctx.createImageData(640, 360);
      const start = performance.now();
      const paint = () => {
        const pulse = Math.sin(
          (2 * Math.PI * 1.2 * (performance.now() - start)) / 1000,
        );
        for (let i = 0; i < base.data.length; i += 4) {
          output.data[i] = base.data[i] * (1 + 0.0066 * pulse);
          output.data[i + 1] = base.data[i + 1] * (1 + 0.0154 * pulse);
          output.data[i + 2] = base.data[i + 2] * (1 + 0.0106 * pulse);
          output.data[i + 3] = 255;
        }
        ctx.putImageData(output, 0, 0);
      };
      paint();
      const timer = setInterval(paint, 33),
        stream = canvas.captureStream(30);
      stream
        .getVideoTracks()[0]
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await page.reload();
  await page.getByRole("button", { name: "Camera", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === "Camera",
      ).disabled,
  );
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".face-mesh") !== null,
    {},
    { timeout: 45000 },
  );
  assert.equal(
    await page
      .locator(".pulse-card")
      .first()
      .getAttribute("data-reading-origin"),
    "simulated",
  );
  assert.ok(
    (await page.getByTestId("pulse-bpm").first().textContent()).includes("≈"),
  );
  await page.screenshot({
    path: "test-results/pulse-fallback.png",
    fullPage: true,
  });
  await page.waitForFunction(
    () => document.querySelector(".pulse-card.locked") !== null,
    {},
    { timeout: 45000 },
  );
  await page.waitForFunction(
    () => {
      const card = document.querySelector(
        '.pulse-card[data-reading-origin="measured"]',
      );
      return (
        card &&
        Math.abs(Number(card.getAttribute("data-measured-bpm")) - 72) <= 2 &&
        Math.abs(Number(card.getAttribute("data-smoothed-bpm")) - 72) <= 2
      );
    },
    {},
    { timeout: 15000 },
  );
  const liveBpm = Number(
    await page
      .locator(".pulse-card.locked")
      .first()
      .getAttribute("data-displayed-bpm"),
  );
  assert.equal(
    await page
      .locator(".pulse-card.locked")
      .first()
      .getAttribute("data-reading-origin"),
    "measured",
  );
  assert.ok(
    Math.abs(liveBpm - 72) <= 4,
    `Expected modulated fixture near 72, got ${liveBpm}`,
  );
  await page.screenshot({
    path: "test-results/pulse-camera-fixture.png",
    fullPage: true,
  });
  const timings = await page
    .locator(".source-card")
    .first()
    .evaluate((element) => ({
      analysisMs: Number(element.getAttribute("data-analysis-ms")),
      poseMs: Number(element.getAttribute("data-pose-ms")),
    }));
  console.log("Frame timings: " + JSON.stringify(timings));
  await page
    .getByRole("button", { name: "Event history", exact: true })
    .click();
  await tabs.getByRole("button", { name: "Dashboard", exact: true }).click();
  assert.ok(
    await page
      .locator("video")
      .evaluate((v) => v.srcObject.getVideoTracks()[0].readyState === "live"),
  );
  await page.locator("video").evaluate((v) => v.pause());
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 0,
  );
  await page.getByRole("button", { name: /Stop Camera/ }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".source-card, .patient-sidebar .patient-card, .face-mesh, .pulse-card",
      ).length === 0,
  );
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".face-mesh") !== null,
  );
  await page.locator("video").evaluate((video) => {
    const track = video.srcObject.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".source-card, .patient-sidebar .patient-card, .face-mesh, .pulse-card",
      ).length === 0,
  );
  await tabs.getByRole("button", { name: "Direct Feed", exact: true }).click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pulse-card.locked").length === 2,
  );
  assert.equal(
    await tabs
      .getByRole("button", { name: "Dashboard", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  assert.equal(await page.locator(".source-card").first().isVisible(), true);
  await page.getByRole("button", { name: /Stop Scene lab/ }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    `Pulse browser passed: two scene signals (${bpm.join(", ")}), independent persistent overlays, library and direct feed navigation, dense meshes, navigation continuity, mobile layout, real face inference and sampled fixture (${liveBpm} BPM), no page errors or external requests.`,
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) =>
    server.exitCode !== null ? r() : server.once("exit", r),
  );
  await rm(data, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
