import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerConfig {
  label: string;
  region: string;
  plan: string;
  snapshotPrefix: string;
  description: string;
}

export interface ServersConfig {
  servers: Record<string, ServerConfig>;
}

export function loadServersConfig(): ServersConfig {
  const configPath = join(__dirname, "..", "servers.json");
  const content = readFileSync(configPath, "utf-8");
  return JSON.parse(content) as ServersConfig;
}

export function getServerConfig(name: string): ServerConfig | undefined {
  const config = loadServersConfig();
  return config.servers[name];
}

export function getServerNames(): string[] {
  const config = loadServersConfig();
  return Object.keys(config.servers);
}

export const env = {
  get discordToken() {
    return process.env.DISCORD_TOKEN!;
  },
  get discordClientId() {
    return process.env.DISCORD_CLIENT_ID!;
  },
  get discordGuildId() {
    return process.env.DISCORD_GUILD_ID || "";
  },
  get vultrApiKey() {
    return process.env.VULTR_API_KEY!;
  },
  get snapshotRetention() {
    return parseInt(process.env.SNAPSHOT_RETENTION || "3", 10);
  },
  get allowedRoleName() {
    return process.env.ALLOWED_ROLE_NAME || "";
  },
  get reminderTime() {
    return process.env.REMINDER_TIME || "";
  },
  get reminderChannelId() {
    return process.env.REMINDER_CHANNEL_ID || "";
  },
};
