import { startServer } from "./app.js";
import { seedDrivers } from "./seed.js";
import { config } from "./config.js";

seedDrivers();

startServer(config.port).catch((err) => {
  console.error("failed to start:", err);
  process.exit(1);
});
