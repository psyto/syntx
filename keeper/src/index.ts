import { loadConfig } from "./config.js";
import { runKeeper } from "./keeper.js";

async function main(): Promise<void> {
  const config = loadConfig();
  await runKeeper(config);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
