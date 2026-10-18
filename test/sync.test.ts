import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDmCreate, runSendLoop } from "../src/discord.js";
import type { SendDeps } from "../src/discord.js";
import { ResponseStore } from "../src/store.js";
import { openDmChannel, syncDmHistory } from "../src/sync.js";
import type { HistoryChannelLike, HistoryMessageLike } from "../src/sync.js";
import type { Config, MemberLike } from "../src/types.js";

const SENT = "2026-10-13T00:00:00.000Z";
const FIRST = "2026-10-13T01:00:00.000Z";
const SECOND = "2026-10-13T02:00:00.000Z";
const EDITED = "2026-10-13T04:00:00.000Z";
const NOW = "2026-10-13T09:00:00.000Z";

function snowflake(n: number): string {
	return String(n).padStart(18, "0");
}

function historyMessage(
	overrides: Partial<HistoryMessageLike> = {},
): HistoryMessageLike {
	return {
		id: "m-new",
		content: "while offline",
		createdAt: new Date(SECOND),
		editedAt: null,
		author: {
			id: "recipient",
			bot: false,
			username: "recipient-name",
			globalName: "표시 이름",
		},
		...overrides,
	};
}

function channel(
	id: string,
	fetch: HistoryChannelLike["messages"]["fetch"],
): HistoryChannelLike {
	return { id, isDMBased: () => true, messages: { fetch } };
}

let store: ResponseStore;
let save: ReturnType<typeof vi.spyOn<ResponseStore, "save">>;

beforeEach(() => {
	store = new ResponseStore(join(tmpdir(), "discord-sync-responses.json"));
	save = vi.spyOn(store, "save").mockResolvedValue(undefined);
});

describe("syncDmHistory", () => {
	it("pages a DM channel, adds missed replies, and updates edits", async () => {
		store.markSent("recipient", SENT, "dm-1");
		store.recordMessage(
			{
				userId: "recipient",
				username: "recipient-name",
				displayName: "표시 이름",
			},
			{ messageId: "m-old", content: "original", sentAt: FIRST },
		);
		const filler = Array.from({ length: 100 }, (_, index) =>
			historyMessage({
				id: snowflake(101 + index),
				content: "안내",
				author: {
					id: "bot",
					bot: true,
					username: "birthday",
					globalName: null,
				},
			}),
		);
		const fetch = vi.fn(async (options: { limit: number; before?: string }) => {
			const batch =
				options.before === undefined ?
					filler
				:	[
						historyMessage({
							id: "m-old",
							content: "revised",
							createdAt: new Date(FIRST),
							editedAt: new Date(EDITED),
						}),
						historyMessage(),
						historyMessage({
							id: "m-other",
							author: {
								id: "someone-else",
								bot: false,
								username: "other",
								globalName: null,
							},
						}),
					];
			return { values: () => batch };
		});
		const delay = vi.fn(async (_ms: number) => undefined);

		const summary = await syncDmHistory({
			store,
			delayMs: 23,
			delay,
			log: vi.fn(),
			openChannel: async () => channel("dm-1", fetch),
		});

		expect(summary).toEqual({
			checked: 1,
			added: 1,
			edited: 1,
			channelsRecorded: 0,
			failed: 0,
		});
		expect(fetch).toHaveBeenNthCalledWith(1, { limit: 100 });
		expect(fetch).toHaveBeenNthCalledWith(2, {
			limit: 100,
			before: snowflake(101),
		});
		expect(delay).toHaveBeenCalledExactlyOnceWith(23);
		expect(save).toHaveBeenCalledTimes(1);
		expect(store.data.responses.recipient?.messages).toEqual([
			{
				messageId: "m-old",
				content: "revised",
				sentAt: FIRST,
				editedAt: EDITED,
			},
			{
				messageId: "m-new",
				content: "while offline",
				sentAt: SECOND,
				editedAt: null,
			},
		]);
	});

	it("stores a missing channel id and skips a second pass when nothing changed", async () => {
		store.markSent("recipient", SENT);
		store.recordMessage(
			{
				userId: "recipient",
				username: "recipient-name",
				displayName: "표시 이름",
			},
			{ messageId: "m-new", content: "while offline", sentAt: SECOND },
		);
		const fetch = vi.fn(async () => ({ values: () => [historyMessage()] }));
		const openChannel = vi.fn(async () => channel("dm-new", fetch));
		const deps = {
			store,
			delayMs: 23,
			delay: vi.fn(async () => undefined),
			log: vi.fn(),
			openChannel,
		};

		expect(await syncDmHistory(deps)).toMatchObject({
			added: 0,
			edited: 0,
			channelsRecorded: 1,
			failed: 0,
		});
		expect(store.getSendState("recipient")?.channelId).toBe("dm-new");
		expect(save).toHaveBeenCalledTimes(1);

		save.mockClear();
		expect(await syncDmHistory(deps)).toMatchObject({
			added: 0,
			edited: 0,
			channelsRecorded: 0,
			failed: 0,
		});
		expect(openChannel).toHaveBeenLastCalledWith({
			userId: "recipient",
			channelId: "dm-new",
		});
		expect(save).not.toHaveBeenCalled();
	});

	it("continues after a channel failure and waits before the next user", async () => {
		store.markSent("bad", SENT, "dm-bad");
		store.markSent("recipient", SENT, "dm-1");
		const events: string[] = [];
		const fetch = vi.fn(async () => {
			events.push("fetch");
			return { values: () => [historyMessage()] };
		});

		const summary = await syncDmHistory({
			store,
			delayMs: 23,
			delay: async () => {
				events.push("delay");
			},
			log: vi.fn(),
			openChannel: async (target) => {
				events.push(target.userId);
				if (target.userId === "bad") throw new Error("missing access");
				return channel("dm-1", fetch);
			},
		});

		expect(summary).toEqual({
			checked: 2,
			added: 1,
			edited: 0,
			channelsRecorded: 0,
			failed: 1,
		});
		expect(events).toEqual(["bad", "delay", "recipient", "fetch"]);
		expect(
			store.data.responses.recipient?.messages.map(
				(message) => message.messageId,
			),
		).toEqual(["m-new"]);
		expect(store.data.responses.bad).toBeUndefined();
	});

	it("counts an unavailable DM channel as a failure without reading messages", async () => {
		store.markSent("recipient", SENT, "dm-1");
		const fetch = vi.fn();
		const summary = await syncDmHistory({
			store,
			delayMs: 23,
			delay: vi.fn(async () => undefined),
			log: vi.fn(),
			openChannel: async () => ({
				id: "guild",
				isDMBased: () => false,
				messages: { fetch },
			}),
		});

		expect(summary.failed).toBe(1);
		expect(fetch).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	});
});

describe("openDmChannel", () => {
	const dm = channel("dm-1", vi.fn());

	it("uses the stored channel when it is a DM", async () => {
		const fetchChannel = vi.fn(async () => dm);
		const createDM = vi.fn();
		await expect(
			openDmChannel(
				{ userId: "recipient", channelId: "dm-1" },
				{ fetchChannel, createDM },
			),
		).resolves.toBe(dm);
		expect(createDM).not.toHaveBeenCalled();
	});

	it.each([
		["missing", undefined, vi.fn()],
		[
			"unreadable",
			"gone",
			vi.fn(async () => {
				throw new Error("unknown channel");
			}),
		],
		[
			"not a dm",
			"guild",
			vi.fn(async () => ({ ...dm, id: "guild", isDMBased: () => false })),
		],
		["empty", "gone", vi.fn(async () => null)],
	] as const)(
		"opens a DM when the stored channel is %s",
		async (_label, channelId, fetchChannel) => {
			const createDM = vi.fn(async () => dm);
			const target =
				channelId === undefined ?
					{ userId: "recipient" }
				:	{ userId: "recipient", channelId };
			await expect(
				openDmChannel(target, { fetchChannel, createDM }),
			).resolves.toBe(dm);
			expect(createDM).toHaveBeenCalledExactlyOnceWith("recipient");
		},
	);
});

describe("channel recording", () => {
	it("stores the channel id returned when a DM is sent", async () => {
		const member: MemberLike = {
			id: "recipient",
			username: "recipient-name",
			globalName: null,
			nickname: null,
			bot: false,
		};
		const config: Config = {
			token: "test-token",
			guildId: "test-guild",
			dmMessage: "롤링 페이퍼를 작성해주세요",
			excludeUserIds: [],
			excludeNames: [],
			sendDelayMs: 1500,
			responsesPath: join(tmpdir(), "discord-sync-responses.json"),
			dryRun: false,
		};
		const deps: SendDeps = {
			members: [member],
			botUserId: "self",
			config,
			store,
			sendDm: vi.fn(async () => "dm-1"),
			delay: vi.fn(async () => undefined),
			now: () => new Date(NOW),
			log: vi.fn(),
		};

		await runSendLoop(deps);
		expect(store.getSendState("recipient")).toEqual({
			status: "sent",
			at: NOW,
			channelId: "dm-1",
		});
	});

	it("remembers the DM channel when a sent recipient replies", async () => {
		store.markSent("recipient", SENT);
		const recorded = await handleDmCreate(
			{
				id: "m-new",
				content: "while offline",
				createdAt: new Date(SECOND),
				editedAt: null,
				partial: false,
				fetch: vi.fn(),
				author: {
					id: "recipient",
					bot: false,
					username: "recipient-name",
					globalName: "표시 이름",
				},
				channel: { id: "dm-9", isDMBased: () => true },
			},
			store,
		);

		expect(recorded).toBe(true);
		expect(store.getSendState("recipient")).toEqual({
			status: "sent",
			at: SENT,
			channelId: "dm-9",
		});
	});
});
