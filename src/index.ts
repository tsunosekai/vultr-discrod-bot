import { config } from "dotenv";
config();

import { startBot } from "./discord/bot.js";

async function main() {
  console.log("Starting Vultr Discord Bot...");

  try {
    await startBot();
    console.log("Bot is running!");
  } catch (error) {
    console.error("Failed to start bot:", error);
    process.exit(1);
  }
}

main();
