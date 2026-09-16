import type { GameEventRecord } from "./types";

type JournalEntry = {
  id: string;
  record: GameEventRecord;
  deliveredAt?: string;
};

const DB_NAME = "spirit-ruins-game-log";
const STORE_NAME = "events";

/** Small write-ahead journal: the parent export stays canonical, this only
 * preserves records if an iframe/browser closes before postMessage arrives. */
export class GameRunJournal {
  private db?: Promise<IDBDatabase>;
  constructor(private readonly sessionId: string, private readonly runId: string) {}

  private open() {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME))
          request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("game journal unavailable"));
    });
    return this.db;
  }

  private id(record: GameEventRecord) {
    return `${this.sessionId}:${this.runId}:${record.eventId}:${record.atMs}:${record.trialIndex ?? ""}:${record.outcome}`;
  }

  async append(record: GameEventRecord) {
    const entry: JournalEntry = { id: this.id(record), record };
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("game journal write failed"));
    });
    return entry;
  }

  async listUndelivered() {
    const db = await this.open();
    const rows = await new Promise<JournalEntry[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as JournalEntry[]);
      request.onerror = () => reject(request.error ?? new Error("game journal read failed"));
    });
    return rows.filter(row => row.record.sessionId === this.sessionId && row.record.runId === this.runId && row.deliveredAt === undefined);
  }

  async markDelivered(id: string) {
    const db = await this.open();
    const entry = await new Promise<JournalEntry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result as JournalEntry | undefined);
      request.onerror = () => reject(request.error ?? new Error("game journal read failed"));
    });
    if (!entry) return;
    const updated = { ...entry, deliveredAt: new Date().toISOString() };
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("game journal delivery write failed"));
    });
  }
}
