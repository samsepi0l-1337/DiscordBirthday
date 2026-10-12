import type { Client } from "discord.js";
import type { ResponseStore } from "./store.js";
import type { Config, MemberLike, SendSummary } from "./types.js";

export interface SendDeps {
  members: MemberLike[];
  botUserId: string;
  config: Config;
  store: ResponseStore;
  sendDm(member: MemberLike, text: string): Promise<void>;
  delay(ms: number): Promise<void>;
  now(): Date;
  log(line: string): void;
}

export interface DmMessageLike {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  partial: boolean;
  fetch(): Promise<DmMessageLike>;
  author: {
    id: string;
    bot: boolean;
    username: string;
    globalName: string | null;
  } | null;
  channel: { isDMBased(): boolean };
}

export interface GuildCommandsLike {
  commands: { set(data: unknown[]): Promise<unknown> };
}

export interface InteractionLike {
  commandName: string;
  inGuild(): boolean;
  memberPermissions: { has(perm: bigint): boolean } | null;
  reply(o: { content: string; ephemeral: boolean }): Promise<unknown>;
  deferReply(o: { ephemeral: boolean }): Promise<unknown>;
  editReply(content: string): Promise<unknown>;
}

// Administrator permission bit (1n << 3n) as a string.
export const SEND_DM_COMMAND = {
  name: "send-dm",
  description: "서버 멤버에게 롤링 페이퍼 DM을 전송합니다",
  default_member_permissions: "8",
  dm_permission: false,
} as const;

export function runSendLoop(_deps: SendDeps): Promise<SendSummary> {
  throw new Error("not implemented");
}

export function handleDmCreate(
  _message: DmMessageLike,
  _store: ResponseStore,
): Promise<boolean> {
  throw new Error("not implemented");
}

export function handleDmUpdate(
  _message: DmMessageLike,
  _store: ResponseStore,
): Promise<boolean> {
  throw new Error("not implemented");
}

export function registerCommands(_guild: GuildCommandsLike): Promise<void> {
  throw new Error("not implemented");
}

export function createSendDmHandler(
  _getDeps: () => Promise<SendDeps>,
): (interaction: InteractionLike) => Promise<void> {
  throw new Error("not implemented");
}

export function createClient(): Client {
  throw new Error("not implemented");
}
