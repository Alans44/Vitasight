import { Store } from "./store.ts";
import { createApp } from "./app.ts";
const store = new Store(process.env.DATA_PATH || "data/reassessment.sqlite");
const { app } = createApp(store);
const server = app.listen(Number(process.env.PORT || 8790), "127.0.0.1", () =>
  console.log(`Reassessment: http://127.0.0.1:${process.env.PORT || 8790}`),
);
function stop() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
