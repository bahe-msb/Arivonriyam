import { createApp } from "./app";
import { env } from "./config/index";
import { initPgDb } from "./lib/pgdb";

initPgDb()
  .then(() => {
    const app = createApp();
    app.listen(env.port, () => {
      console.log(`Server running at http://localhost:${env.port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialise Postgres schema:", err);
    process.exit(1);
  });
