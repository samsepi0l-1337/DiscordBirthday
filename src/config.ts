import type { Config, MemberLike } from "./types.js";

const DEFAULT_SEND_DELAY_MS = 1500;
const DEFAULT_RESPONSES_PATH = "data/responses.json";

export function parseList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const token = required(env, "DISCORD_TOKEN");
  const guildId = required(env, "GUILD_ID");
  const dmMessage = required(env, "DM_MESSAGE");

  let sendDelayMs = DEFAULT_SEND_DELAY_MS;
  const rawDelay = env.SEND_DELAY_MS?.trim();
  if (rawDelay) {
    const parsed = Number(rawDelay);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`Invalid SEND_DELAY_MS: ${rawDelay}`);
    }
    sendDelayMs = parsed;
  }

  const responsesPath = env.RESPONSES_PATH?.trim() || DEFAULT_RESPONSES_PATH;
  const dryRun = env.DRY_RUN?.trim().toLowerCase() === "true";

  return {
    token,
    guildId,
    dmMessage,
    excludeUserIds: parseList(env.EXCLUDE_USER_IDS),
    excludeNames: parseList(env.EXCLUDE_NAMES),
    sendDelayMs,
    responsesPath,
    dryRun,
  };
}

export function isExcluded(
  member: MemberLike,
  config: Pick<Config, "excludeUserIds" | "excludeNames">,
  botUserId: string,
): boolean {
  if (member.bot || member.id === botUserId) return true;
  if (config.excludeUserIds.includes(member.id)) return true;

  const excluded = new Set(config.excludeNames.map((n) => n.toLowerCase()));
  const names = [member.username, member.globalName, member.nickname];
  return names.some((n) => n !== null && excluded.has(n.toLowerCase()));
}
