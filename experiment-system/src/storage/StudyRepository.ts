import type { AllocationMetadata, StudySession } from "../domain/types";

/** Persistence seam. The browser (IndexedDB) is the data store in this phase. */
export interface StudyRepository {
  save(session: StudySession): Promise<void>;
  get(id: string): Promise<StudySession | undefined>;
  /** Sessions that can still be resumed. */
  listIncomplete(): Promise<StudySession[]>;
  /**
   * Atomically consumes one position of the balanced block-of-two allocation.
   * Must read and write the allocation state in one transaction so rapid
   * consecutive session creations never reuse a block position.
   */
  allocateConditionOrder(): Promise<{
    counterbalanceCell: "AB" | "BA";
    allocation: AllocationMetadata;
  }>;
}
