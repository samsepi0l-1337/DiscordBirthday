export interface Config {
  token: string;
  guildId: string;
  dmMessage: string;
  excludeUserIds: string[];
  excludeNames: string[];
  sendDelayMs: number;
  responsesPath: string;
  dryRun: boolean;
}

export interface MemberLike {
  id: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  bot: boolean;
}

export interface UserInfo {
  userId: string;
  username: string;
  displayName: string;
}

export interface IncomingMessage {
  messageId: string;
  content: string;
  sentAt: string;
}

export interface EditedMessage extends IncomingMessage {
  editedAt: string;
}

export interface ResponseMessage {
  messageId: string;
  content: string;
  sentAt: string;
  editedAt: string | null;
}

export interface UserResponse {
  userId: string;
  username: string;
  displayName: string;
  firstRepliedAt: string;
  lastUpdatedAt: string;
  messages: ResponseMessage[];
}

export interface SendRecord {
  status: "sent" | "failed";
  at: string;
  reason?: string;
}

export interface StoreData {
  responses: Record<string, UserResponse>;
  sendState: Record<string, SendRecord>;
}

export interface SendSummary {
  sent: number;
  skipped: number;
  failed: number;
  dryRun: number;
}
