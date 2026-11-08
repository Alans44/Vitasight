import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "vitasight-browser-"));
const port = Number(process.env.BROWSER_TEST_PORT || 18790),
  url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_PATH: join(data, "test.sqlite"),
    POSE_PORT: "18999",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url + "/api/state");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("Preview did not start: " + logs);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [],
    external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (!r.url().startsWith(url) && !r.url().startsWith("data:"))
      external.push(r.url());
  });
  await page.addInitScript(() => {
    const NativeAudioContext = window.AudioContext;
    window.__vitasightAudio = { starts: 0, peaks: [] };
    window.AudioContext = class extends NativeAudioContext {
      constructor() {
        super();
        this.meter = this.createAnalyser();
        this.meter.connect(this.destination);
        const samples = new Float32Array(this.meter.fftSize);
        const timer = setInterval(() => {
          if (this.state === "closed") return clearInterval(timer);
          this.meter.getFloatTimeDomainData(samples);
          window.__vitasightAudio.peaks.push(
            Math.max(...samples.map(Math.abs)),
          );
        }, 20);
      }
      createGain() {
        const gain = super.createGain();
        const connect = gain.connect.bind(gain);
        gain.connect = (target, ...args) =>
          connect(target === this.destination ? this.meter : target, ...args);
        return gain;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args) => {
          window.__vitasightAudio.starts++;
          return start(...args);
        };
        return oscillator;
      }
    };
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Start demo", exact: true }).waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await page.getByLabel("Fall sensitivity").waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Text alerts", exact: true })
      .count(),
    0,
  );
  assert.equal(await page.getByLabel("Fall sensitivity").inputValue(), "high");
  assert.equal(
    Number(await page.getByLabel("Slump hold (seconds)").inputValue()),
    0.75,
  );
  await page.screenshot({
    path: "test-results/settings-desktop.png",
    fullPage: true,
  });
  const smsSetup = await (await fetch(url + "/api/state")).json();
  assert.equal(smsSetup.sms.available, false);
  assert.equal(smsSetup.sms.preferences.enabled, false);
  assert.equal(smsSetup.sms.notifications.length, 0);
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  const source = page.locator(".source-card").first();
  await source
    .getByRole("combobox", { name: "Associate Person 1 in Scene lab 1" })
    .waitFor();
  const people = await (await fetch(url + "/api/state")).json();
  const patient = people.patients.find((p) => p.name === "Alex Morgan");
  await source
    .getByRole("combobox", { name: "Associate Person 1 in Scene lab 1" })
    .selectOption(patient.id);
  await source.getByLabel("Scenario").selectOption("posture");
  const card = page.locator(".event-card").first();
  await card.waitFor({ timeout: 15000 });
  await page.screenshot({
    path: "test-results/desktop-monitor.png",
    fullPage: true,
  });
  await card.click();
  const drawer = page.getByRole("dialog");
  await drawer
    .getByRole("button", { name: "Acknowledge", exact: true })
    .click();
  await drawer.getByRole("button", { name: "Assign to me" }).click();
  await drawer
    .getByLabel("Outcome or dismissal reason")
    .fill("Browser check: reassessment completed.");
  await drawer.getByRole("button", { name: "Record reassessment" }).click();
  await drawer.locator(".status.resolved").waitFor();
  await page.getByRole("button", { name: "Close request" }).click();
  await page.getByRole("button", { name: /Event history/ }).click();
  await page.getByRole("searchbox", { name: "Search events" }).fill("Alex");
  await page.locator("tbody tr").waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.reload();
  await page.getByRole("button", { name: /Event history/ }).click();
  await page.locator("tbody .status.resolved").waitFor();
  const exported = await (await fetch(url + "/api/export")).json();
  assert.equal(exported.events[0].status, "resolved");
  assert.equal(exported.patients.find((p) => p.id === patient.id).priority, 3);
  assert.ok(exported.audit.some((a) => a.action === "reassess"));
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await source
    .getByRole("button", { name: "Stop Scene lab 1", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".source-card").length === 0,
  );
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await source.locator(".track-row").first().waitFor();
  const soundsBeforeFall = await page.evaluate(() => {
    window.__vitasightAudio.peaks = [];
    return window.__vitasightAudio.starts;
  });
  await source.getByLabel("Scenario").selectOption("fall");
  const fallBanner = page.getByRole("alert", {
    name: "Fall alert",
    exact: true,
  });
  await fallBanner.waitFor({ timeout: 5000 });
  await page.waitForFunction(() =>
    window.__vitasightAudio.peaks.some((peak) => peak > 0.01),
  );
  await page.waitForTimeout(1300);
  const fallSound = await page.evaluate(() => {
    let bursts = 0,
      active = false;
    for (const peak of window.__vitasightAudio.peaks) {
      const audible = peak > 0.006;
      if (audible && !active) bursts++;
      active = audible;
    }
    return { starts: window.__vitasightAudio.starts, bursts };
  });
  assert.equal(
    fallSound.starts,
    soundsBeforeFall + 1,
    "One alarm per fall episode",
  );
  assert.equal(fallSound.bursts, 3, "Fall alarm has three audible bursts");
  await page.getByRole("button", { name: "Mute alerts", exact: true }).click();
  await page.locator(".patient-card.fall-event").waitFor();
  await source.locator(".feed-fall-alert").waitFor();
  await source
    .getByRole("button", { name: "Body landmarks", exact: true })
    .click();
  assert.equal(await fallBanner.isVisible(), true);
  assert.equal(await source.locator(".feed-fall-alert").isVisible(), true);
  await source
    .getByRole("button", { name: "Body landmarks", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/fall-alert-desktop.png",
    fullPage: true,
  });
  const fallState = await (await fetch(url + "/api/state")).json();
  assert.equal(
    fallState.events.filter((event) => event.kind === "fall").length,
    1,
  );
  assert.equal(
    fallState.events.find((event) => event.kind === "fall").mode,
    "demo",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/fall-alert-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Fall alert mobile horizontal overflow",
  );
  await fallBanner.getByRole("button", { name: "Review alert" }).click();
  await drawer
    .getByRole("button", { name: "Acknowledge", exact: true })
    .click();
  await drawer.locator(".status.acknowledged").waitFor();
  await page.getByRole("button", { name: "Close request" }).click();
  assert.equal(await fallBanner.count(), 0);
  let releaseStop;
  const stopped = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const stopRoute = async (route) => {
    await stopped;
    await route.continue();
  };
  await page.route("**/api/sources/*/stop", stopRoute);
  try {
    await source
      .getByRole("button", { name: "Stop Scene lab 1", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          ".source-card, .patient-sidebar .patient-card",
        ).length === 0,
    );
    assert.equal(
      (await (await fetch(url + "/api/state")).json()).feeds.length,
      1,
      "Source stop is still awaiting server confirmation",
    );
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator(".patient-sidebar .patient-card").count(),
      0,
      "Stale polls cannot restore stopped people",
    );
  } finally {
    releaseStop();
  }
  await page.waitForFunction(
    async () => (await (await fetch("/api/state")).json()).feeds.length === 0,
  );
  await page.unroute("**/api/sources/*/stop", stopRoute);
  await page.getByRole("button", { name: "Start demo", exact: true }).click();
  await source.locator(".track-row").first().waitFor();
  await source.getByLabel("Scenario").selectOption("fall");
  await fallBanner.waitFor();
  await page.waitForTimeout(600);
  assert.equal(
    await page.evaluate(() => window.__vitasightAudio.starts),
    fallSound.starts,
    "Muted falls stay silent",
  );
  await source
    .getByRole("button", { name: "Stop Scene lab 1", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(
        ".source-card, .patient-sidebar .patient-card, .fall-alert-banner",
      ).length === 0,
  );
  await page.waitForFunction(
    async () => (await (await fetch("/api/state")).json()).feeds.length === 0,
  );
  await page.reload();
  await page.getByRole("button", { name: /Event history/ }).click();
  await page
    .getByRole("searchbox", { name: "Search events" })
    .fill("Possible fall");
  await page.locator("tbody .status.acknowledged").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile horizontal overflow",
  );
  assert.deepEqual(errors, []);
  await page
    .getByRole("button", { name: "Configuration", exact: true })
    .click();
  await page.getByLabel("Fall sensitivity").waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "Text alerts", exact: true })
      .count(),
    0,
  );
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Settings mobile horizontal overflow",
  );
  assert.deepEqual(
    external,
    [],
    "App must not request remote services or fonts",
  );
  console.log(
    "Browser passed: three-burst fall audio, mute, immediate people cleanup through delayed stop responses, saved event history, slump/fall review flow, desktop/mobile layouts, and shelved text controls.",
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
