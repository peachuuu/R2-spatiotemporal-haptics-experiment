import type { AllocationMetadata, StudySession } from "../domain/types";
import { nextBalancedAllocation, randomBit, type AllocationState } from "../integration/balancedAllocation";
import type { StudyRepository } from "./StudyRepository";

const DB_NAME = "electrotactile-study";
const DB_VERSION = 2;
const STORE_NAME = "sessions";
const META_STORE_NAME = "metadata";
const ALLOCATION_KEY = "allocationState";

type MetadataRow = { key: string; value: unknown };

/** Local-only persistence. No data ever leaves this browser except via explicit export. */
export class IndexedDbStudyRepository implements StudyRepository {
  private dbPromise: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        if (!db.objectStoreNames.contains(META_STORE_NAME))
          db.createObjectStore(META_STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB"));
    });
    return this.dbPromise;
  }

  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }

  async save(session: StudySession): Promise<void> {
    await this.withStore("readwrite", store => store.put(session));
  }

  async get(id: string): Promise<StudySession | undefined> {
    return this.withStore("readonly", store => store.get(id));
  }

  async listIncomplete(): Promise<StudySession[]> {
    const all = await this.withStore<StudySession[]>("readonly", store => store.getAll());
    return all.filter(session => session.status === "in-progress");
  }

  /**
   * Atomic allocation: reads the persisted block state and writes the next
   * position inside a single readwrite transaction on the metadata store.
   */
  async allocateConditionOrder(): Promise<{
    counterbalanceCell: "AB" | "BA";
    allocation: AllocationMetadata;
  }> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE_NAME, "readwrite");
      const store = tx.objectStore(META_STORE_NAME);
      const read = store.get(ALLOCATION_KEY) as IDBRequest<MetadataRow | undefined>;
      read.onsuccess = () => {
        const state = (read.result?.value ?? undefined) as AllocationState | undefined;
        // Only the first position of a block consumes randomness.
        const bit = state === undefined || state.nextPosition === 0 ? randomBit() : 0;
        const result = nextBalancedAllocation(state, bit);
        store.put({ key: ALLOCATION_KEY, value: result.nextState } satisfies MetadataRow);
        resolve({
          counterbalanceCell: result.allocation.cell,
          allocation: result.allocation.metadata
        });
      };
      read.onerror = () => reject(read.error ?? new Error("allocation read failed"));
      tx.onerror = () => reject(tx.error ?? new Error("allocation transaction failed"));
    });
  }

  /** Closes the underlying connection; the repository can be reopened afterwards. */
  async close(): Promise<void> {
    if (this.dbPromise === undefined) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = undefined;
  }
}
