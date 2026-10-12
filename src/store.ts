import type {
  EditedMessage,
  IncomingMessage,
  SendRecord,
  StoreData,
  UserInfo,
} from "./types.js";

export class ResponseStore {
  constructor(
    protected readonly filePath: string,
    protected readonly state?: StoreData,
  ) {}

  static load(_filePath: string): Promise<ResponseStore> {
    throw new Error("not implemented");
  }

  get data(): StoreData {
    throw new Error("not implemented");
  }

  recordMessage(_user: UserInfo, _msg: IncomingMessage): void {
    throw new Error("not implemented");
  }

  recordEdit(_user: UserInfo, _msg: EditedMessage): void {
    throw new Error("not implemented");
  }

  getSendState(_userId: string): SendRecord | undefined {
    throw new Error("not implemented");
  }

  markSent(_userId: string, _at: string): void {
    throw new Error("not implemented");
  }

  markFailed(_userId: string, _reason: string, _at: string): void {
    throw new Error("not implemented");
  }

  save(): Promise<void> {
    throw new Error("not implemented");
  }
}
