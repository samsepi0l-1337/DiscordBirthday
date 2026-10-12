import { describe, it, expect } from 'vitest';
import { isExcluded, loadConfig, parseList } from '../src/config.js';
import type { MemberLike } from '../src/types.js';

const requiredEnv = {
  DISCORD_TOKEN: 'test-token',
  GUILD_ID: 'test-guild',
  DM_MESSAGE: '롤링 페이퍼를 작성해주세요',
};

describe('loadConfig', () => {
  it('uses the documented defaults with only required variables', () => {
    expect(loadConfig(requiredEnv)).toEqual({
      token: 'test-token',
      guildId: 'test-guild',
      dmMessage: '롤링 페이퍼를 작성해주세요',
      excludeUserIds: [],
      excludeNames: [],
      sendDelayMs: 1500,
      responsesPath: 'data/responses.json',
      dryRun: false,
    });
  });

  it('parses a fully specified environment', () => {
    expect(loadConfig({
      ...requiredEnv,
      EXCLUDE_USER_IDS: ' 123, ,456, ',
      EXCLUDE_NAMES: ' Alice, ,밥, ',
      SEND_DELAY_MS: '2500',
      RESPONSES_PATH: 'custom/replies.json',
      DRY_RUN: 'true',
    })).toEqual({
      token: 'test-token',
      guildId: 'test-guild',
      dmMessage: '롤링 페이퍼를 작성해주세요',
      excludeUserIds: ['123', '456'],
      excludeNames: ['Alice', '밥'],
      sendDelayMs: 2500,
      responsesPath: 'custom/replies.json',
      dryRun: true,
    });
  });

  it.each(['DISCORD_TOKEN', 'GUILD_ID', 'DM_MESSAGE'])(
    'names missing %s in its error',
    (variable) => {
      const env: Record<string, string | undefined> = { ...requiredEnv };
      delete env[variable];
      expect(() => loadConfig(env)).toThrow(new RegExp(variable));
    },
  );
});

describe('parseList', () => {
  it('trims entries and drops empty entries', () => {
    expect(parseList(' Alice, , Bob ,,\tCarol\n, ')).toEqual(['Alice', 'Bob', 'Carol']);
  });

  it('returns an empty list for undefined', () => {
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('isExcluded', () => {
  const member: MemberLike = {
    id: 'user-1',
    username: 'alice',
    globalName: 'Alice Global',
    nickname: 'Alice Nick',
    bot: false,
  };

  it('matches user IDs exactly', () => {
    expect(isExcluded(member, { excludeUserIds: ['user-1'], excludeNames: [] }, 'bot-id')).toBe(true);
    expect(isExcluded(member, { excludeUserIds: ['USER-1', 'user-10'], excludeNames: [] }, 'bot-id')).toBe(false);
  });

  it.each([
    ['username', 'ALICE'],
    ['globalName', 'aLiCe gLoBaL'],
    ['nickname', 'ALICE NICK'],
  ])('matches %s case-insensitively', (_field, name) => {
    expect(isExcluded(member, { excludeUserIds: [], excludeNames: [name] }, 'bot-id')).toBe(true);
  });

  it('always excludes bots and the bot user itself', () => {
    const config = { excludeUserIds: [], excludeNames: [] };
    expect(isExcluded({ ...member, bot: true }, config, 'bot-id')).toBe(true);
    expect(isExcluded({ ...member, id: 'bot-id' }, config, 'bot-id')).toBe(true);
  });

  it('allows a non-matching member with absent optional names', () => {
    expect(isExcluded(
      { ...member, globalName: null, nickname: null },
      { excludeUserIds: ['other-user'], excludeNames: ['other-name'] },
      'bot-id',
    )).toBe(false);
  });
});
