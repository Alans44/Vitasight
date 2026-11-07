import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "reassessment-browser-"));
const port = Number(process.env.BROWSER_TEST_PORT || 18790),
  url = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_PATH: join(data, "test.sqlite"),
      POSE_PORT: "18999",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
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
  await page.goto(url);
  await page.getByRole("button", { name: "Start demo", exact: true }).waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/desktop-empty.png",
    fullPage: true,
  });
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Monitor", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    "Mobile horizontal overflow",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    external,
    [],
    "App must not request remote services or fonts",
  );
  console.log(
    "Browser passed: demo → association → sustained event → acknowledgment → assignment → reassessment → search/export/reload; mobile layout; no page errors or external requests.",
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) =>
    server.exitCode !== null ? r() : server.once("exit", r),
  );
  await rm(data, { recursive: true, force: true });
}
