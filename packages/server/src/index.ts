import { createApp } from "./app";
import { env } from "./config/index";

const app = createApp();

app.listen(env.port, () => {
  console.log(`Server running at http://localhost:${env.port}`);
});
