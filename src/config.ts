import type { Config, MemberLike } from "./types.js";

export function parseList(_value: string | undefined): string[] {
  throw new Error("not implemented");
}

export function loadConfig(_env: Record<string, string | undefined>): Config {
  throw new Error("not implemented");
}

export function isExcluded(
  _member: MemberLike,
  _config: Pick<Config, "excludeUserIds" | "excludeNames">,
  _botUserId: string,
): boolean {
  throw new Error("not implemented");
}
