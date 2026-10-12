import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResponseStore } from '../src/store.js';

const user = { userId: 'user-1', username: 'alice', displayName: 'Alice Global' };
const firstAt = '2026-10-13T01:00:00.000Z';
const secondAt = '2026-10-13T02:00:00.000Z';
const thirdAt = '2026-10-13T03:00:00.000Z';
const editedAt = '2026-10-13T04:00:00.000Z';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'discord-response-store-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('ResponseStore', () => {
  it('loads a missing file as empty data', async () => {
    const store = await ResponseStore.load(join(directory, 'responses.json'));
    expect(store.data).toEqual({ responses: {}, sendState: {} });
  });

  it('keeps consecutive messages separate in arrival order and updates reply timestamps', () => {
    const store = new ResponseStore(join(directory, 'responses.json'));
    store.recordMessage(user, { messageId: 'm1', content: 'First reply', sentAt: firstAt });
    expect(store.data.responses[user.userId]).toEqual({
      ...user,
      firstRepliedAt: firstAt,
      lastUpdatedAt: firstAt,
      messages: [{ messageId: 'm1', content: 'First reply', sentAt: firstAt, editedAt: null }],
    });

    store.recordMessage(user, { messageId: 'm3', content: 'Second arrival', sentAt: thirdAt });
    store.recordMessage(user, { messageId: 'm2', content: 'Third arrival', sentAt: secondAt });
    expect(store.data.responses[user.userId]).toEqual({
      ...user,
      firstRepliedAt: firstAt,
      lastUpdatedAt: secondAt,
      messages: [
        { messageId: 'm1', content: 'First reply', sentAt: firstAt, editedAt: null },
        { messageId: 'm3', content: 'Second arrival', sentAt: thirdAt, editedAt: null },
        { messageId: 'm2', content: 'Third arrival', sentAt: secondAt, editedAt: null },
      ],
    });
  });

  it('edits only the matching entry and preserves the first reply timestamp', () => {
    const store = new ResponseStore(join(directory, 'responses.json'));
    store.recordMessage(user, { messageId: 'm1', content: 'First reply', sentAt: firstAt });
    store.recordMessage(user, { messageId: 'm2', content: 'Second reply', sentAt: secondAt });
    store.recordMessage(user, { messageId: 'm3', content: 'Third reply', sentAt: thirdAt });

    store.recordEdit(user, {
      messageId: 'm2', content: 'Revised second reply', sentAt: secondAt, editedAt,
    });
    expect(store.data.responses[user.userId]).toEqual({
      ...user,
      firstRepliedAt: firstAt,
      lastUpdatedAt: editedAt,
      messages: [
        { messageId: 'm1', content: 'First reply', sentAt: firstAt, editedAt: null },
        { messageId: 'm2', content: 'Revised second reply', sentAt: secondAt, editedAt },
        { messageId: 'm3', content: 'Third reply', sentAt: thirdAt, editedAt: null },
      ],
    });
  });

  it('inserts an unknown edited message in sentAt order without losing existing replies', () => {
    const store = new ResponseStore(join(directory, 'responses.json'));
    store.markSent(user.userId, '2026-10-13T00:00:00.000Z');
    store.recordMessage(user, { messageId: 'm1', content: 'First reply', sentAt: firstAt });
    store.recordMessage(user, { messageId: 'm3', content: 'Third reply', sentAt: thirdAt });

    store.recordEdit(user, {
      messageId: 'm2', content: 'Recovered edited reply', sentAt: secondAt, editedAt,
    });
    expect(store.data.responses[user.userId]).toEqual({
      ...user,
      firstRepliedAt: firstAt,
      lastUpdatedAt: editedAt,
      messages: [
        { messageId: 'm1', content: 'First reply', sentAt: firstAt, editedAt: null },
        { messageId: 'm2', content: 'Recovered edited reply', sentAt: secondAt, editedAt },
        { messageId: 'm3', content: 'Third reply', sentAt: thirdAt, editedAt: null },
      ],
    });
  });

  it('creates parent directories, saves the documented JSON shape, and reloads responses and send states', async () => {
    const parent = join(directory, 'nested', 'data');
    const filePath = join(parent, 'responses.json');
    const store = new ResponseStore(filePath);
    const sentAt = '2026-10-13T00:00:00.000Z';
    const failedAt = '2026-10-13T00:01:00.000Z';
    store.markSent(user.userId, sentAt);
    store.markFailed('user-2', 'Cannot send messages to this user (50007)', failedAt);
    store.recordMessage(user, { messageId: 'm1', content: 'Original reply', sentAt: firstAt });
    store.recordEdit(user, { messageId: 'm1', content: 'Edited reply', sentAt: firstAt, editedAt });

    const expected = {
      responses: {
        [user.userId]: {
          ...user,
          firstRepliedAt: firstAt,
          lastUpdatedAt: editedAt,
          messages: [{ messageId: 'm1', content: 'Edited reply', sentAt: firstAt, editedAt }],
        },
      },
      sendState: {
        [user.userId]: { status: 'sent', at: sentAt },
        'user-2': { status: 'failed', at: failedAt, reason: 'Cannot send messages to this user (50007)' },
      },
    };

    await store.save();
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(expected);
    expect(await readdir(parent)).toEqual(['responses.json']);

    const reloaded = await ResponseStore.load(filePath);
    expect(reloaded.data).toEqual(expected);
    expect(reloaded.getSendState(user.userId)).toEqual(expected.sendState[user.userId]);
    expect(reloaded.getSendState('user-2')).toEqual(expected.sendState['user-2']);
  });
});
