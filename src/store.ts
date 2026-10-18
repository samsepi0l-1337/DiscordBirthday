import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	EditedMessage,
	IncomingMessage,
	ResponseMessage,
	SendRecord,
	StoreData,
	UserInfo,
	UserResponse,
} from "./types.js";

export interface ChannelHistoryEntry {
	messageId: string;
	content: string;
	sentAt: string;
	editedAt: string | null;
	authorId: string;
	username: string;
	displayName: string;
}

export class ResponseStore {
	private readonly state: StoreData;

	constructor(
		protected readonly filePath: string,
		data?: StoreData,
	) {
		this.state = data ?? { responses: {}, sendState: {} };
	}

	static async load(filePath: string): Promise<ResponseStore> {
		let raw: string;
		try {
			raw = await readFile(filePath, "utf8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				return new ResponseStore(filePath);
			}
			throw err;
		}
		const parsed = JSON.parse(raw) as Partial<StoreData>;
		return new ResponseStore(filePath, {
			responses: parsed.responses ?? {},
			sendState: parsed.sendState ?? {},
		});
	}

	get data(): StoreData {
		return structuredClone(this.state);
	}

	recordMessage(user: UserInfo, msg: IncomingMessage): void {
		const record = this.ensureUser(user, msg.sentAt);
		record.messages.push({
			messageId: msg.messageId,
			content: msg.content,
			sentAt: msg.sentAt,
			editedAt: null,
		});
		record.lastUpdatedAt = msg.sentAt;
	}

	recordEdit(user: UserInfo, msg: EditedMessage): void {
		const record = this.ensureUser(user, msg.sentAt);
		const existing = record.messages.find((m) => m.messageId === msg.messageId);
		if (existing) {
			existing.content = msg.content;
			existing.editedAt = msg.editedAt;
		} else {
			record.messages.push({
				messageId: msg.messageId,
				content: msg.content,
				sentAt: msg.sentAt,
				editedAt: msg.editedAt,
			});
			record.messages.sort((a, b) =>
				a.sentAt < b.sentAt ? -1
				: a.sentAt > b.sentAt ? 1
				: 0,
			);
			if (msg.sentAt < record.firstRepliedAt)
				record.firstRepliedAt = msg.sentAt;
		}
		record.lastUpdatedAt = msg.editedAt;
	}

	getSendState(userId: string): SendRecord | undefined {
		return this.state.sendState[userId];
	}

	markSent(userId: string, at: string, channelId?: string): void {
		const previous = this.state.sendState[userId];
		const next: SendRecord = { status: "sent", at };
		const kept =
			channelId ||
			(previous?.status === "sent" ? previous.channelId : undefined);
		if (kept) next.channelId = kept;
		this.state.sendState[userId] = next;
	}

	markFailed(userId: string, reason: string, at: string): void {
		this.state.sendState[userId] = { status: "failed", at, reason };
	}

	listDmTargets(): { userId: string; channelId?: string }[] {
		const targets: { userId: string; channelId?: string }[] = [];
		for (const [userId, record] of Object.entries(this.state.sendState)) {
			if (record.status !== "sent") continue;
			targets.push(
				record.channelId ? { userId, channelId: record.channelId } : { userId },
			);
		}
		return targets;
	}

	rememberChannel(userId: string, channelId: string): boolean {
		if (!channelId) return false;
		const record = this.state.sendState[userId];
		if (!record || record.status !== "sent" || record.channelId === channelId)
			return false;
		record.channelId = channelId;
		return true;
	}

	applyChannelHistory(
		userId: string,
		channelId: string,
		entries: ChannelHistoryEntry[],
	): { added: number; edited: number; channelRecorded: boolean } {
		if (this.getSendState(userId)?.status !== "sent") {
			return { added: 0, edited: 0, channelRecorded: false };
		}
		const channelRecorded = this.rememberChannel(userId, channelId);
		let added = 0;
		let edited = 0;
		const ordered = entries
			.filter((entry) => entry.authorId === userId)
			.sort((a, b) =>
				a.sentAt < b.sentAt ? -1
				: a.sentAt > b.sentAt ? 1
				: 0,
			);
		for (const entry of ordered) {
			const outcome = this.upsertHistoryMessage(entry);
			if (outcome === "added") added++;
			else if (outcome === "edited") edited++;
		}
		return { added, edited, channelRecorded };
	}

	async save(): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		const tmpPath = `${this.filePath}.${process.pid}.tmp`;
		try {
			await writeFile(
				tmpPath,
				JSON.stringify(this.state, null, 2) + "\n",
				"utf8",
			);
			await rename(tmpPath, this.filePath);
		} catch (err) {
			await rm(tmpPath, { force: true });
			throw err;
		}
	}

	private upsertHistoryMessage(
		entry: ChannelHistoryEntry,
	): "added" | "edited" | "unchanged" {
		const user = {
			userId: entry.authorId,
			username: entry.username,
			displayName: entry.displayName,
		};
		const current = this.state.responses[entry.authorId];
		const existing = current?.messages.find(
			(message) => message.messageId === entry.messageId,
		);
		if (existing) {
			if (
				existing.content === entry.content &&
				existing.editedAt === entry.editedAt
			)
				return "unchanged";
			existing.content = entry.content;
			existing.editedAt = entry.editedAt;
			this.touchHistory(user, entry);
			return "edited";
		}
		const record = this.ensureUser(user, entry.sentAt);
		record.messages.push(historyMessage(entry));
		record.messages.sort((a, b) =>
			a.sentAt < b.sentAt ? -1
			: a.sentAt > b.sentAt ? 1
			: 0,
		);
		this.touchHistory(user, entry);
		return "added";
	}

	private touchHistory(user: UserInfo, entry: ChannelHistoryEntry): void {
		const record = this.ensureUser(user, entry.sentAt);
		if (entry.sentAt < record.firstRepliedAt)
			record.firstRepliedAt = entry.sentAt;
		const touched = entry.editedAt ?? entry.sentAt;
		if (touched > record.lastUpdatedAt) record.lastUpdatedAt = touched;
	}

	private ensureUser(user: UserInfo, firstAt: string): UserResponse {
		let record = this.state.responses[user.userId];
		if (!record) {
			record = {
				userId: user.userId,
				username: user.username,
				displayName: user.displayName,
				firstRepliedAt: firstAt,
				lastUpdatedAt: firstAt,
				messages: [],
			};
			this.state.responses[user.userId] = record;
		} else {
			record.username = user.username;
			record.displayName = user.displayName;
		}
		return record;
	}
}

function historyMessage(entry: ChannelHistoryEntry): ResponseMessage {
	return {
		messageId: entry.messageId,
		content: entry.content,
		sentAt: entry.sentAt,
		editedAt: entry.editedAt,
	};
}
