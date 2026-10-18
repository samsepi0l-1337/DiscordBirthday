import { Client, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import type { ResponseStore } from "./store.js";
import { isExcluded } from "./config.js";
import type { Config, MemberLike, SendSummary } from "./types.js";

export interface SendDeps {
	members: MemberLike[];
	botUserId: string;
	config: Config;
	store: ResponseStore;
	sendDm(member: MemberLike, text: string): Promise<string | undefined>;
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
	channel: { id?: string; isDMBased(): boolean };
}

export interface GuildCommandsLike {
	commands: { set(data: unknown[]): Promise<unknown> };
}

export interface InteractionLike {
	commandName: string;
	inGuild(): boolean;
	memberPermissions: { has(perm: bigint): boolean } | null;
	reply(o: { content: string; flags: number }): Promise<unknown>;
	deferReply(o: { flags: number }): Promise<unknown>;
	editReply(content: string): Promise<unknown>;
}

// Administrator permission bit (1n << 3n) as a string.
export const SEND_DM_COMMAND = {
	name: "send-dm",
	description: "서버 멤버에게 롤링 페이퍼 DM을 전송합니다",
	default_member_permissions: "8",
	dm_permission: false,
} as const;

const ADMINISTRATOR = 8n;

function failureReason(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	const code = (err as { code?: unknown } | null)?.code;
	return code !== undefined && code !== null ? `${code}: ${message}` : message;
}

export async function runSendLoop(deps: SendDeps): Promise<SendSummary> {
	const { config, store } = deps;
	const summary: SendSummary = { sent: 0, skipped: 0, failed: 0, dryRun: 0 };

	const queue: MemberLike[] = [];
	for (const member of deps.members) {
		if (
			isExcluded(member, config, deps.botUserId) ||
			store.getSendState(member.id)?.status === "sent"
		) {
			summary.skipped++;
		} else {
			queue.push(member);
		}
	}

	for (let i = 0; i < queue.length; i++) {
		const member = queue[i]!;
		if (config.dryRun) {
			deps.log(`[DRY_RUN] would DM ${member.id} (${member.username})`);
			summary.dryRun++;
			continue;
		}
		try {
			const channelId = await deps.sendDm(member, config.dmMessage);
			store.markSent(member.id, deps.now().toISOString(), channelId);
			summary.sent++;
		} catch (err) {
			store.markFailed(member.id, failureReason(err), deps.now().toISOString());
			summary.failed++;
		}
		await store.save();
		if (i < queue.length - 1) await deps.delay(config.sendDelayMs);
	}
	return summary;
}

async function handleDm(
	message: DmMessageLike,
	store: ResponseStore,
	isEdit: boolean,
): Promise<boolean> {
	const msg = message.partial ? await message.fetch() : message;
	const author = msg.author;
	if (!msg.channel.isDMBased() || !author || author.bot) return false;
	if (store.getSendState(author.id)?.status !== "sent") return false;

	const user = {
		userId: author.id,
		username: author.username,
		displayName: author.globalName ?? author.username,
	};
	const sentAt = msg.createdAt.toISOString();
	if (isEdit) {
		if (!msg.editedAt) return false;
		store.recordEdit(user, {
			messageId: msg.id,
			content: msg.content,
			sentAt,
			editedAt: msg.editedAt.toISOString(),
		});
	} else {
		store.recordMessage(user, {
			messageId: msg.id,
			content: msg.content,
			sentAt,
		});
	}
	if (msg.channel.id) store.rememberChannel(author.id, msg.channel.id);
	await store.save();
	return true;
}

export function handleDmCreate(
	message: DmMessageLike,
	store: ResponseStore,
): Promise<boolean> {
	return handleDm(message, store, false);
}

export function handleDmUpdate(
	message: DmMessageLike,
	store: ResponseStore,
): Promise<boolean> {
	return handleDm(message, store, true);
}

export async function registerCommands(
	guild: GuildCommandsLike,
): Promise<void> {
	await guild.commands.set([SEND_DM_COMMAND]);
}

export function createSendDmHandler(
	getDeps: () => Promise<SendDeps>,
): (interaction: InteractionLike) => Promise<void> {
	let running = false;

	return async (interaction) => {
		if (interaction.commandName !== SEND_DM_COMMAND.name) return;

		if (
			!interaction.inGuild() ||
			!interaction.memberPermissions ||
			!interaction.memberPermissions.has(ADMINISTRATOR)
		) {
			await interaction.reply({
				flags: MessageFlags.Ephemeral,
				content: "이 명령어는 서버 관리자만 사용할 수 있습니다.",
			});
			return;
		}

		if (running) {
			await interaction.reply({
				flags: MessageFlags.Ephemeral,
				content: "이미 전송이 진행 중입니다.",
			});
			return;
		}

		running = true;
		try {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			let text: string;
			try {
				const summary = await runSendLoop(await getDeps());
				text =
					`전송 완료: 성공 ${summary.sent}, 건너뜀 ${summary.skipped}, ` +
					`실패 ${summary.failed}, 드라이런 ${summary.dryRun}`;
			} catch (err) {
				text = `오류로 실패했습니다: ${err instanceof Error ? err.message : String(err)}`;
			}
			await interaction.editReply(text);
		} finally {
			running = false;
		}
	};
}

export function createClient(): Client {
	return new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.DirectMessages,
		],
		partials: [Partials.Channel, Partials.Message],
	});
}
