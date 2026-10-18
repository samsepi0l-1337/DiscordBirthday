import type { ChannelHistoryEntry, ResponseStore } from "./store.js";

const PAGE_LIMIT = 100;

export interface DmTarget {
	userId: string;
	channelId?: string;
}

export interface HistoryMessageLike {
	id: string;
	content: string;
	createdAt: Date;
	editedAt: Date | null;
	author: {
		id: string;
		bot: boolean;
		username: string;
		globalName: string | null;
	} | null;
}

export interface HistoryChannelLike {
	id: string;
	isDMBased(): boolean;
	messages: {
		fetch(options: { limit: number; before?: string }): Promise<{
			values(): Iterable<HistoryMessageLike>;
		}>;
	};
}

export interface SyncSummary {
	checked: number;
	added: number;
	edited: number;
	channelsRecorded: number;
	failed: number;
}

export async function openDmChannel(
	target: DmTarget,
	io: {
		fetchChannel(channelId: string): Promise<HistoryChannelLike | null>;
		createDM(userId: string): Promise<HistoryChannelLike>;
	},
): Promise<HistoryChannelLike> {
	if (target.channelId) {
		try {
			const channel = await io.fetchChannel(target.channelId);
			if (channel?.isDMBased()) return channel;
		} catch {
			// The stored id can disappear. Opening the user's DM is the fallback.
		}
	}
	return io.createDM(target.userId);
}

export async function syncDmHistory(deps: {
	store: ResponseStore;
	openChannel(target: DmTarget): Promise<HistoryChannelLike | null>;
	delay(ms: number): Promise<void>;
	delayMs: number;
	log(line: string): void;
}): Promise<SyncSummary> {
	const summary: SyncSummary = {
		checked: 0,
		added: 0,
		edited: 0,
		channelsRecorded: 0,
		failed: 0,
	};
	const targets = deps.store.listDmTargets();
	summary.checked = targets.length;

	for (let i = 0; i < targets.length; i++) {
		const target = targets[i]!;
		try {
			const channel = await deps.openChannel(target);
			if (!channel?.isDMBased()) {
				summary.failed++;
				deps.log(`[sync] skip ${target.userId}: DM channel unavailable`);
			} else {
				await applyChannel(deps, summary, target.userId, channel);
			}
		} catch (err) {
			summary.failed++;
			const message = err instanceof Error ? err.message : String(err);
			deps.log(`[sync] failed ${target.userId}: ${message}`);
		}
		if (i < targets.length - 1) await deps.delay(deps.delayMs);
	}

	deps.log(
		`[sync] checked ${summary.checked}, added ${summary.added}, edited ${summary.edited}, ` +
			`channels ${summary.channelsRecorded}, failed ${summary.failed}`,
	);
	return summary;
}

async function applyChannel(
	deps: {
		store: ResponseStore;
		delay(ms: number): Promise<void>;
		delayMs: number;
		log(line: string): void;
	},
	summary: SyncSummary,
	userId: string,
	channel: HistoryChannelLike,
): Promise<void> {
	const messages = await readChannelMessages(channel, deps.delay, deps.delayMs);
	const result = deps.store.applyChannelHistory(
		userId,
		channel.id,
		toHistoryEntries(userId, messages),
	);
	summary.added += result.added;
	summary.edited += result.edited;
	if (result.channelRecorded) summary.channelsRecorded++;
	if (result.added > 0 || result.edited > 0 || result.channelRecorded) {
		await deps.store.save();
		if (result.added > 0 || result.edited > 0) {
			deps.log(
				`[sync] ${userId}: added ${result.added}, edited ${result.edited}`,
			);
		}
	}
}

async function readChannelMessages(
	channel: HistoryChannelLike,
	delay: (ms: number) => Promise<void>,
	delayMs: number,
): Promise<HistoryMessageLike[]> {
	const all: HistoryMessageLike[] = [];
	let before: string | undefined;
	for (;;) {
		const page = await channel.messages.fetch(
			before === undefined ?
				{ limit: PAGE_LIMIT }
			:	{ limit: PAGE_LIMIT, before },
		);
		const batch = [...page.values()];
		all.push(...batch);
		if (batch.length < PAGE_LIMIT) break;
		const earliest = earliestId(batch);
		if (earliest === before) break;
		before = earliest;
		await delay(delayMs);
	}
	return all;
}

function earliestId(messages: HistoryMessageLike[]): string {
	return messages.reduce(
		(earliest, message) =>
			BigInt(message.id) < BigInt(earliest) ? message.id : earliest,
		messages[0]!.id,
	);
}

function toHistoryEntries(
	userId: string,
	messages: HistoryMessageLike[],
): ChannelHistoryEntry[] {
	const entries: ChannelHistoryEntry[] = [];
	for (const message of messages) {
		const author = message.author;
		if (!author || author.bot || author.id !== userId) continue;
		entries.push({
			messageId: message.id,
			content: message.content,
			sentAt: message.createdAt.toISOString(),
			editedAt: message.editedAt?.toISOString() ?? null,
			authorId: author.id,
			username: author.username,
			displayName: author.globalName ?? author.username,
		});
	}
	return entries;
}
