import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResponseStore } from "../src/store.js";

const user = {
	userId: "user-1",
	username: "alice",
	displayName: "Alice Global",
};
const firstAt = "2026-10-13T01:00:00.000Z";
const secondAt = "2026-10-13T02:00:00.000Z";
const thirdAt = "2026-10-13T03:00:00.000Z";
const editedAt = "2026-10-13T04:00:00.000Z";

let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), "discord-response-store-"));
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("ResponseStore", () => {
	it("loads a missing file as empty data", async () => {
		const store = await ResponseStore.load(join(directory, "responses.json"));
		expect(store.data).toEqual({ responses: {}, sendState: {} });
	});

	it("keeps consecutive messages separate in arrival order and updates reply timestamps", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.recordMessage(user, {
			messageId: "m1",
			content: "First reply",
			sentAt: firstAt,
		});
		expect(store.data.responses[user.userId]).toEqual({
			...user,
			firstRepliedAt: firstAt,
			lastUpdatedAt: firstAt,
			messages: [
				{
					messageId: "m1",
					content: "First reply",
					sentAt: firstAt,
					editedAt: null,
				},
			],
		});

		store.recordMessage(user, {
			messageId: "m3",
			content: "Second arrival",
			sentAt: thirdAt,
		});
		store.recordMessage(user, {
			messageId: "m2",
			content: "Third arrival",
			sentAt: secondAt,
		});
		expect(store.data.responses[user.userId]).toEqual({
			...user,
			firstRepliedAt: firstAt,
			lastUpdatedAt: secondAt,
			messages: [
				{
					messageId: "m1",
					content: "First reply",
					sentAt: firstAt,
					editedAt: null,
				},
				{
					messageId: "m3",
					content: "Second arrival",
					sentAt: thirdAt,
					editedAt: null,
				},
				{
					messageId: "m2",
					content: "Third arrival",
					sentAt: secondAt,
					editedAt: null,
				},
			],
		});
	});

	it("edits only the matching entry and preserves the first reply timestamp", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.recordMessage(user, {
			messageId: "m1",
			content: "First reply",
			sentAt: firstAt,
		});
		store.recordMessage(user, {
			messageId: "m2",
			content: "Second reply",
			sentAt: secondAt,
		});
		store.recordMessage(user, {
			messageId: "m3",
			content: "Third reply",
			sentAt: thirdAt,
		});

		store.recordEdit(user, {
			messageId: "m2",
			content: "Revised second reply",
			sentAt: secondAt,
			editedAt,
		});
		expect(store.data.responses[user.userId]).toEqual({
			...user,
			firstRepliedAt: firstAt,
			lastUpdatedAt: editedAt,
			messages: [
				{
					messageId: "m1",
					content: "First reply",
					sentAt: firstAt,
					editedAt: null,
				},
				{
					messageId: "m2",
					content: "Revised second reply",
					sentAt: secondAt,
					editedAt,
				},
				{
					messageId: "m3",
					content: "Third reply",
					sentAt: thirdAt,
					editedAt: null,
				},
			],
		});
	});

	it("inserts an unknown edited message in sentAt order without losing existing replies", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.markSent(user.userId, "2026-10-13T00:00:00.000Z");
		store.recordMessage(user, {
			messageId: "m1",
			content: "First reply",
			sentAt: firstAt,
		});
		store.recordMessage(user, {
			messageId: "m3",
			content: "Third reply",
			sentAt: thirdAt,
		});

		store.recordEdit(user, {
			messageId: "m2",
			content: "Recovered edited reply",
			sentAt: secondAt,
			editedAt,
		});
		expect(store.data.responses[user.userId]).toEqual({
			...user,
			firstRepliedAt: firstAt,
			lastUpdatedAt: editedAt,
			messages: [
				{
					messageId: "m1",
					content: "First reply",
					sentAt: firstAt,
					editedAt: null,
				},
				{
					messageId: "m2",
					content: "Recovered edited reply",
					sentAt: secondAt,
					editedAt,
				},
				{
					messageId: "m3",
					content: "Third reply",
					sentAt: thirdAt,
					editedAt: null,
				},
			],
		});
	});

	it("creates parent directories, saves the documented JSON shape, and reloads responses and send states", async () => {
		const parent = join(directory, "nested", "data");
		const filePath = join(parent, "responses.json");
		const store = new ResponseStore(filePath);
		const sentAt = "2026-10-13T00:00:00.000Z";
		const failedAt = "2026-10-13T00:01:00.000Z";
		store.markSent(user.userId, sentAt);
		store.markFailed(
			"user-2",
			"Cannot send messages to this user (50007)",
			failedAt,
		);
		store.recordMessage(user, {
			messageId: "m1",
			content: "Original reply",
			sentAt: firstAt,
		});
		store.recordEdit(user, {
			messageId: "m1",
			content: "Edited reply",
			sentAt: firstAt,
			editedAt,
		});

		const expected = {
			responses: {
				[user.userId]: {
					...user,
					firstRepliedAt: firstAt,
					lastUpdatedAt: editedAt,
					messages: [
						{
							messageId: "m1",
							content: "Edited reply",
							sentAt: firstAt,
							editedAt,
						},
					],
				},
			},
			sendState: {
				[user.userId]: { status: "sent", at: sentAt },
				"user-2": {
					status: "failed",
					at: failedAt,
					reason: "Cannot send messages to this user (50007)",
				},
			},
		};

		await store.save();
		expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(expected);
		expect(await readdir(parent)).toEqual(["responses.json"]);

		const reloaded = await ResponseStore.load(filePath);
		expect(reloaded.data).toEqual(expected);
		expect(reloaded.getSendState(user.userId)).toEqual(
			expected.sendState[user.userId],
		);
		expect(reloaded.getSendState("user-2")).toEqual(
			expected.sendState["user-2"],
		);
	});

	it("keeps DM channel ids for sent users and reloads them", async () => {
		const filePath = join(directory, "responses.json");
		const store = new ResponseStore(filePath);
		store.markSent(user.userId, firstAt, "dm-1");
		store.markSent("plain", secondAt);
		store.markFailed("failed", "closed", thirdAt);
		store.markSent(user.userId, editedAt);
		store.markSent("plain", thirdAt, "dm-2");

		expect(store.listDmTargets()).toEqual([
			{ userId: user.userId, channelId: "dm-1" },
			{ userId: "plain", channelId: "dm-2" },
		]);
		expect(store.getSendState(user.userId)).toEqual({
			status: "sent",
			at: editedAt,
			channelId: "dm-1",
		});

		await store.save();
		const reloaded = await ResponseStore.load(filePath);
		expect(reloaded.listDmTargets()).toEqual(store.listDmTargets());
		expect(reloaded.getSendState("failed")).toEqual({
			status: "failed",
			at: thirdAt,
			reason: "closed",
		});
	});

	it("reconciles missed and edited DM history without dropping messages absent from the channel", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.markSent(user.userId, "2026-10-13T00:00:00.000Z", "dm-1");
		store.recordMessage(user, {
			messageId: "m1",
			content: "First reply",
			sentAt: firstAt,
		});
		store.recordMessage(user, {
			messageId: "kept",
			content: "Kept reply",
			sentAt: thirdAt,
		});

		const first = store.applyChannelHistory(user.userId, "dm-1", [
			entry({
				messageId: "m1",
				content: "Revised first reply",
				sentAt: firstAt,
				editedAt,
			}),
			entry({
				messageId: "m2",
				content: "Missed reply",
				sentAt: secondAt,
				editedAt: null,
			}),
			entry({
				messageId: "m4",
				content: "Edited while offline",
				sentAt: editedAt,
				editedAt: "2026-10-13T05:00:00.000Z",
			}),
			entry({
				messageId: "other",
				content: "not theirs",
				sentAt: secondAt,
				authorId: "someone-else",
			}),
		]);
		expect(first).toEqual({ added: 2, edited: 1, channelRecorded: false });
		expect(store.data.responses[user.userId]).toEqual({
			...user,
			firstRepliedAt: firstAt,
			lastUpdatedAt: "2026-10-13T05:00:00.000Z",
			messages: [
				{
					messageId: "m1",
					content: "Revised first reply",
					sentAt: firstAt,
					editedAt,
				},
				{
					messageId: "m2",
					content: "Missed reply",
					sentAt: secondAt,
					editedAt: null,
				},
				{
					messageId: "kept",
					content: "Kept reply",
					sentAt: thirdAt,
					editedAt: null,
				},
				{
					messageId: "m4",
					content: "Edited while offline",
					sentAt: editedAt,
					editedAt: "2026-10-13T05:00:00.000Z",
				},
			],
		});

		expect(
			store.applyChannelHistory(user.userId, "dm-1", [
				entry({
					messageId: "m1",
					content: "Revised first reply",
					sentAt: firstAt,
					editedAt,
				}),
				entry({
					messageId: "m2",
					content: "Missed reply",
					sentAt: secondAt,
					editedAt: null,
				}),
			]),
		).toEqual({ added: 0, edited: 0, channelRecorded: false });
	});

	it("pulls firstRepliedAt earlier for a recovered message and leaves a newer lastUpdatedAt in place", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.markSent(user.userId, "2026-10-13T00:00:00.000Z");
		store.recordMessage(user, {
			messageId: "m2",
			content: "Second reply",
			sentAt: secondAt,
		});

		expect(
			store.applyChannelHistory(user.userId, "dm-9", [
				entry({
					messageId: "m1",
					content: "Recovered reply",
					sentAt: firstAt,
					editedAt: null,
				}),
				entry({
					messageId: "m2",
					content: "Second reply",
					sentAt: secondAt,
					editedAt: null,
				}),
			]),
		).toEqual({ added: 1, edited: 0, channelRecorded: true });
		expect(store.data.responses[user.userId]).toMatchObject({
			firstRepliedAt: firstAt,
			lastUpdatedAt: secondAt,
		});
		expect(
			store.data.responses[user.userId]?.messages.map(
				(message) => message.messageId,
			),
		).toEqual(["m1", "m2"]);
		expect(store.getSendState(user.userId)?.channelId).toBe("dm-9");
	});

	it("ignores channel history unless the user was successfully sent a DM", () => {
		const store = new ResponseStore(join(directory, "responses.json"));
		store.markFailed(user.userId, "closed", firstAt);
		const before = store.data;

		expect(
			store.applyChannelHistory(user.userId, "dm-1", [
				entry({
					messageId: "m1",
					content: "Late reply",
					sentAt: secondAt,
					editedAt: null,
				}),
			]),
		).toEqual({ added: 0, edited: 0, channelRecorded: false });
		expect(store.data).toEqual(before);
	});
});

function entry(overrides: {
	messageId: string;
	content: string;
	sentAt: string;
	editedAt: string | null;
	authorId?: string;
}) {
	return {
		messageId: overrides.messageId,
		content: overrides.content,
		sentAt: overrides.sentAt,
		editedAt: overrides.editedAt,
		authorId: overrides.authorId ?? user.userId,
		username: user.username,
		displayName: user.displayName,
	};
}
