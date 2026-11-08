import { Store } from "./store.ts";
import { createApp } from "./app.ts";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const dataPath = process.env.DATA_PATH || "data/reassessment.sqlite";
const store = new Store(dataPath);
const { app, sms } = createApp(store, {
  sms: {
    credentialsPath: join(dirname(dataPath), "sms-credentials.json"),
    active: process.env.VITASIGHT_SMS_ENABLED === "true",
  },
});
const dispatch = () =>
  void sms
    .tick()
    .catch(() =>
      console.error(
        "Text notification dispatch is unavailable; check the local event log.",
      ),
    );
const smsTimer = sms.snapshot().available
  ? setInterval(dispatch, 1000)
  : undefined;
smsTimer?.unref();
dispatch();
const server = app.listen(Number(process.env.PORT || 8790), "127.0.0.1", () =>
  console.log(`Vitasight: http://127.0.0.1:${process.env.PORT || 8790}`),
);
function stop() {
  if (smsTimer) clearInterval(smsTimer);
  server.close(async () => {
    await sms.tick();
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
