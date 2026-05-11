import os from "node:os";
import { createApp } from "./app";
import { env } from "./config/index";
import { initPgDb } from "./lib/pgdb";

const HOST = "0.0.0.0";

function getLanUrls(port: number): string[] {
  const urls = new Set<string>();

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      urls.add(`http://${address.address}:${port}`);
    }
  }

  return [...urls];
}

initPgDb()
  .then(() => {
    const app = createApp();
    app.listen(env.port, HOST, () => {
      console.log(`Server running at http://localhost:${env.port}`);
      for (const url of getLanUrls(env.port)) {
        console.log(`LAN: ${url}`);
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialise Postgres schema:", err);
    process.exit(1);
  });
