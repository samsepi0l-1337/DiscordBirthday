import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createClient,
  createSendDmHandler,
  handleDmCreate,
  handleDmUpdate,
  registerCommands,
  runSendLoop,
  SEND_DM_COMMAND,
} from '../src/discord.js';
import type { DmMessageLike, InteractionLike, SendDeps } from '../src/discord.js';
import { ResponseStore } from '../src/store.js';
import type { Config, MemberLike } from '../src/types.js';

const NOW = new Date('2026-10-13T09:00:00.000Z');
const CREATED = new Date('2026-10-13T10:00:00.000Z');
const EDITED = new Date('2026-10-13T11:00:00.000Z');
const OLD = '2026-10-12T09:00:00.000Z';

function member(id: string, overrides: Partial<MemberLike> = {}): MemberLike {
  return { id, username: `user-${id}`, globalName: null, nickname: null, bot: false, ...overrides };
}

function message(overrides: Partial<DmMessageLike> = {}): DmMessageLike {
  return {
    id: 'message-1',
    content: '첫 번째 답장',
    createdAt: CREATED,
    editedAt: null,
    partial: false,
    fetch: vi.fn<() => Promise<DmMessageLike>>(),
    author: { id: 'recipient', bot: false, username: 'recipient-name', globalName: '표시 이름' },
    channel: { isDMBased: () => true },
    ...overrides,
  };
}

function interaction(overrides: Partial<InteractionLike> = {}) {
  return {
    commandName: 'send-dm',
    inGuild: vi.fn(() => true),
    memberPermissions: { has: vi.fn((_permission: bigint) => true) },
    reply: vi.fn(async (_options: { content: string; flags: number }) => undefined),
    deferReply: vi.fn(async (_options: { flags: number }) => undefined),
    editReply: vi.fn(async (_content: string) => undefined),
    ...overrides,
  };
}

let store: ResponseStore;
let save: ReturnType<typeof vi.spyOn<ResponseStore, 'save'>>;

beforeEach(() => {
  // Every save is spied and replaced: no file writes or Discord connections occur.
  store = new ResponseStore(join(tmpdir(), 'discord-test-responses.json'));
  save = vi.spyOn(store, 'save').mockResolvedValue(undefined);
});

function deps(members: MemberLike[], configOverrides: Partial<Config> = {}) {
  const config: Config = {
    token: 'test-token',
    guildId: 'test-guild',
    dmMessage: '롤링 페이퍼를 작성해주세요',
    excludeUserIds: [],
    excludeNames: [],
    sendDelayMs: 1500,
    responsesPath: join(tmpdir(), 'discord-test-responses.json'),
    dryRun: false,
    ...configOverrides,
  };
  return {
    members,
    botUserId: 'self',
    config,
    store,
    sendDm: vi.fn(async (_member: MemberLike, _text: string) => undefined),
    delay: vi.fn(async (_ms: number) => undefined),
    now: () => NOW,
    log: vi.fn((_line: string) => undefined),
  } satisfies SendDeps;
}

 describe('runSendLoop', () => {
  it('skips excluded and sent members, retries failed members, records failures and continues with throttling', async () => {
    store.markSent('already', OLD);
    store.markFailed('retry', 'old failure', OLD);
    const d = deps([
      member('already'),
      member('excluded'),
      member('retry'),
      member('named', { nickname: 'Excluded Name' }),
      member('closed'),
      member('bot', { bot: true }),
      member('self'),
      member('last'),
    ], { excludeUserIds: ['excluded'], excludeNames: ['excluded name'], sendDelayMs: 23 });
    const events: string[] = [];
    d.sendDm.mockImplementation(async (recipient) => {
      events.push(`send:${recipient.id}`);
      if (recipient.id === 'closed') {
        throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
      }
    });
    save.mockImplementation(async () => { events.push('save'); });
    d.delay.mockImplementation(async (ms) => { events.push(`delay:${ms}`); });

    expect(await runSendLoop(d)).toEqual({ sent: 2, skipped: 5, failed: 1, dryRun: 0 });
    expect(d.sendDm.mock.calls).toEqual([
      [d.members[2], d.config.dmMessage],
      [d.members[4], d.config.dmMessage],
      [d.members[7], d.config.dmMessage],
    ]);
    expect(store.data.sendState).toEqual({
      already: { status: 'sent', at: OLD },
      retry: { status: 'sent', at: NOW.toISOString() },
      closed: { status: 'failed', at: NOW.toISOString(), reason: '50007: Cannot send messages to this user' },
      last: { status: 'sent', at: NOW.toISOString() },
    });
    expect(save).toHaveBeenCalledTimes(3);
    expect(events.slice(0, 8)).toEqual([
      'send:retry', 'save', 'delay:23',
      'send:closed', 'save', 'delay:23',
      'send:last', 'save',
    ]);
    // A trailing delay is allowed; there must be no extra delay for skipped members.
    expect(events.slice(8)).toEqual(events.length === 8 ? [] : ['delay:23']);
    expect(d.delay.mock.calls.every(([ms]) => ms === 23)).toBe(true);
  });

  it('logs eligible dry-run members without sending, changing send state or delaying', async () => {
    store.markSent('already', OLD);
    store.markFailed('retry', 'previous failure', OLD);
    const before = store.data;
    const d = deps([
      member('already'), member('excluded'), member('retry'), member('new'),
    ], { dryRun: true, excludeUserIds: ['excluded'] });

    expect(await runSendLoop(d)).toEqual({ sent: 0, skipped: 2, failed: 0, dryRun: 2 });
    expect(d.sendDm).not.toHaveBeenCalled();
    expect(store.data).toEqual(before);
    expect(save).not.toHaveBeenCalled();
    expect(d.delay).not.toHaveBeenCalled();
    const lines = d.log.mock.calls.map(([line]) => line);
    expect(lines.some((line) => line.includes('retry'))).toBe(true);
    expect(lines.some((line) => line.includes('new'))).toBe(true);
  });
});

 describe('DM handlers', () => {
  it.each([
    ['create', handleDmCreate],
    ['update', handleDmUpdate],
  ] as const)('%s ignores guild channels, bots, null authors, unknown users and failed recipients', async (_name, handle) => {
    store.markSent('recipient', OLD);
    store.markFailed('failed', 'cannot DM', OLD);
    const before = store.data;
    const author = message().author!;
    const ignored = [
      message({ channel: { isDMBased: () => false }, editedAt: EDITED }),
      message({ author: { ...author, bot: true }, editedAt: EDITED }),
      message({ author: null, editedAt: EDITED }),
      message({ author: { ...author, id: 'unknown' }, editedAt: EDITED }),
      message({ author: { ...author, id: 'failed' }, editedAt: EDITED }),
    ];

    for (const incoming of ignored) {
      expect(await handle(incoming, store)).toBe(false);
    }
    expect(store.data).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });

  it('fetches a partial create and records separate messages in arrival order using fetched data', async () => {
    store.markSent('recipient', OLD);
    const fetched = message();
    const fetch = vi.fn(async () => fetched);
    const partial = message({ partial: true, author: null, content: '', fetch });
    const second = message({
      id: 'message-2', content: '두 번째 답장',
      createdAt: new Date('2026-10-13T10:01:00.000Z'),
      author: { ...fetched.author!, globalName: null },
    });

    expect(await handleDmCreate(partial, store)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await handleDmCreate(second, store)).toBe(true);
    expect(store.data.responses.recipient).toMatchObject({
      userId: 'recipient', username: 'recipient-name', displayName: 'recipient-name',
      firstRepliedAt: CREATED.toISOString(), lastUpdatedAt: second.createdAt.toISOString(),
      messages: [
        { messageId: 'message-1', content: '첫 번째 답장', sentAt: CREATED.toISOString(), editedAt: null },
        { messageId: 'message-2', content: '두 번째 답장', sentAt: second.createdAt.toISOString(), editedAt: null },
      ],
    });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('routes a fetched partial edit to only the matching entry and preserves the other message', async () => {
    store.markSent('recipient', OLD);
    const original = message();
    const second = message({ id: 'message-2', content: 'unchanged' });
    await handleDmCreate(original, store);
    await handleDmCreate(second, store);
    const untouched = store.data.responses.recipient!.messages[1];
    save.mockClear();
    const fetched = message({ content: '수정한 답장', editedAt: EDITED });
    const fetch = vi.fn(async () => fetched);

    expect(await handleDmUpdate(message({ partial: true, author: null, fetch }), store)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.data.responses.recipient).toMatchObject({
      displayName: '표시 이름',
      lastUpdatedAt: EDITED.toISOString(),
      messages: [
        { messageId: 'message-1', content: '수정한 답장', sentAt: CREATED.toISOString(), editedAt: EDITED.toISOString() },
        untouched,
      ],
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ignores an update with no editedAt after fetching', async () => {
    store.markSent('recipient', OLD);
    const before = store.data;
    const fetch = vi.fn(async () => message({ editedAt: null }));

    expect(await handleDmUpdate(message({ partial: true, editedAt: EDITED, fetch }), store)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.data).toEqual(before);
    expect(save).not.toHaveBeenCalled();
  });
});

 describe('client and command registration', () => {
  it('registers the guild command with Administrator permission and DMs disabled', async () => {
    const guild = { commands: { set: vi.fn(async (_data: unknown[]) => undefined) } };

    await registerCommands(guild);

    expect(guild.commands.set).toHaveBeenCalledExactlyOnceWith([SEND_DM_COMMAND]);
    expect(SEND_DM_COMMAND).toMatchObject({
      name: 'send-dm', default_member_permissions: '8', dm_permission: false,
    });
  });

  it('creates a client with the guild/member/DM intents and channel/message partials', async () => {
    const client = createClient();
    try {
      for (const intent of [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]) {
        expect(client.options.intents.has(intent)).toBe(true);
      }
      expect(client.options.partials).toEqual(expect.arrayContaining([Partials.Channel, Partials.Message]));
    } finally {
      await client.destroy();
    }
  });
});

 describe('createSendDmHandler', () => {
  it.each(['outside-guild', 'null-permissions', 'non-admin'] as const)('rejects %s ephemerally without obtaining deps or sending', async (kind) => {
    const d = deps([member('recipient')]);
    const getDeps = vi.fn(async () => d);
    const has = vi.fn((_permission: bigint) => false);
    const caller = interaction({
      inGuild: () => kind !== 'outside-guild',
      memberPermissions: kind === 'null-permissions' ? null : { has },
    });

    await createSendDmHandler(getDeps)(caller);

    expect(caller.reply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral, content: expect.any(String) });
    expect(caller.reply.mock.calls[0]![0].content.trim()).not.toBe('');
    expect(getDeps).not.toHaveBeenCalled();
    expect(d.sendDm).not.toHaveBeenCalled();
    expect(caller.deferReply).not.toHaveBeenCalled();
    expect(caller.editReply).not.toHaveBeenCalled();
    if (kind === 'non-admin') expect(has).toHaveBeenCalledWith(8n);
  });

  it('ignores other command names without replying or obtaining deps', async () => {
    const getDeps = vi.fn(async () => deps([]));
    const caller = interaction({ commandName: 'other-command' });

    await createSendDmHandler(getDeps)(caller);

    expect(getDeps).not.toHaveBeenCalled();
    expect(caller.reply).not.toHaveBeenCalled();
    expect(caller.deferReply).not.toHaveBeenCalled();
    expect(caller.editReply).not.toHaveBeenCalled();
  });

  it('defers ephemerally before obtaining deps and edits the reply with the summary counts', async () => {
    store.markSent('skip-1', OLD);
    store.markSent('skip-2', OLD);
    const d = deps([
      member('sent'), member('skip-1'), member('skip-2'),
      member('fail-1'), member('fail-2'), member('fail-3'),
    ]);
    d.sendDm.mockImplementation(async (recipient) => {
      if (recipient.id.startsWith('fail-')) throw new Error('closed DMs');
    });
    const caller = interaction();
    const getDeps = vi.fn(async () => {
      expect(caller.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
      return d;
    });

    await createSendDmHandler(getDeps)(caller);

    expect(caller.memberPermissions!.has).toHaveBeenCalledWith(8n);
    expect(getDeps).toHaveBeenCalledTimes(1);
    expect(caller.reply).not.toHaveBeenCalled();
    expect(caller.editReply).toHaveBeenCalledTimes(1);
    const text = caller.editReply.mock.calls[0]![0];
    for (const count of [1, 2, 3, 0]) {
      expect(text).toMatch(new RegExp(`(^|[^0-9])${count}([^0-9]|$)`));
    }
  });

  it('rejects a concurrent run while a send is pending and allows a later invocation', async () => {
    let release!: () => void;
    let signalStarted!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const firstDeps = deps([member('first')]);
    firstDeps.sendDm.mockImplementation(async () => {
      signalStarted();
      await pending;
    });
    const laterDeps = deps([member('later')]);
    const getDeps = vi.fn<() => Promise<SendDeps>>()
      .mockResolvedValueOnce(firstDeps)
      .mockResolvedValueOnce(laterDeps);
    const handler = createSendDmHandler(getDeps);
    const first = interaction();
    const concurrent = interaction();
    const later = interaction();
    const firstRun = handler(first);
    await started;

    try {
      await handler(concurrent);
      expect(concurrent.reply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral, content: expect.any(String) });
      expect(concurrent.reply.mock.calls[0]![0].content).toMatch(/progress|running|진행|실행|처리/i);
      expect(concurrent.deferReply).not.toHaveBeenCalled();
      expect(concurrent.editReply).not.toHaveBeenCalled();
      expect(getDeps).toHaveBeenCalledTimes(1);
      expect(firstDeps.sendDm).toHaveBeenCalledTimes(1);
      expect(laterDeps.sendDm).not.toHaveBeenCalled();
    } finally {
      release();
      await firstRun;
    }

    await handler(later);
    expect(getDeps).toHaveBeenCalledTimes(2);
    expect(later.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(later.reply).not.toHaveBeenCalled();
    expect(laterDeps.sendDm).toHaveBeenCalledExactlyOnceWith(laterDeps.members[0], laterDeps.config.dmMessage);
    expect(later.editReply).toHaveBeenCalledTimes(1);
  });

  it('edits an error reply and clears the active flag when obtaining deps fails', async () => {
    const d = deps([member('recipient')]);
    const getDeps = vi.fn<() => Promise<SendDeps>>()
      .mockRejectedValueOnce(new Error('member fetch unavailable'))
      .mockResolvedValueOnce(d);
    const handler = createSendDmHandler(getDeps);
    const failed = interaction();

    await handler(failed);

    expect(failed.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(failed.editReply).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/error|failed|오류|실패|member fetch unavailable/i));
    const retry = interaction();
    await handler(retry);
    expect(getDeps).toHaveBeenCalledTimes(2);
    expect(retry.reply).not.toHaveBeenCalled();
    expect(retry.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(d.sendDm).toHaveBeenCalledTimes(1);
    expect(retry.editReply).toHaveBeenCalledTimes(1);
  });
});
