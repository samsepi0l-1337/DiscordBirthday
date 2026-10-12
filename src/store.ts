import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  EditedMessage,
  IncomingMessage,
  SendRecord,
  StoreData,
  UserInfo,
  UserResponse,
} from "./types.js";

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
      record.messages.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
      if (msg.sentAt < record.firstRepliedAt) record.firstRepliedAt = msg.sentAt;
    }
    record.lastUpdatedAt = msg.editedAt;
  }

  getSendState(userId: string): SendRecord | undefined {
    return this.state.sendState[userId];
  }

  markSent(userId: string, at: string): void {
    this.state.sendState[userId] = { status: "sent", at };
  }

  markFailed(userId: string, reason: string, at: string): void {
    this.state.sendState[userId] = { status: "failed", at, reason };
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(this.state, null, 2) + "\n", "utf8");
      await rename(tmpPath, this.filePath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
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
