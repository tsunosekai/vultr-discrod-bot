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
  get discordGuildId() {
    return process.env.DISCORD_GUILD_ID!;
  },
  get vultrApiKey() {
    return process.env.VULTR_API_KEY!;
  },
  get snapshotRetention() {
    return parseInt(process.env.SNAPSHOT_RETENTION || "3", 10);
  },
};
