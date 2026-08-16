import type { Draft, PersistentState, SubmissionRecord } from "./types";

function emptyState(): PersistentState {
  return { version: 1, drafts: {}, processedMessages: {}, submissions: {} };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class JsonStateStore {
  private state: PersistentState = emptyState();
  private inMemoryProcessed = new Set<string>();

  constructor(private readonly _filePath?: string) {}

  async initialize(): Promise<void> {
    this.state = emptyState();
    this.inMemoryProcessed.clear();
  }

  async getDraft(key: string): Promise<Draft | undefined> {
    const draft = this.state.drafts[key];
    return draft ? clone(draft) : undefined;
  }

  async saveDraft(draft: Draft): Promise<void> {
    this.state.drafts[draft.key] = clone(draft);
  }

  async cancelDraft(key: string): Promise<void> {
    delete this.state.drafts[key];
  }

  async completeDraft(key: string, submission: SubmissionRecord): Promise<void> {
    this.state.submissions[submission.id] = clone(submission);
    delete this.state.drafts[key];
  }

  async hasProcessedMessage(messageId: string): Promise<boolean> {
    return this.inMemoryProcessed.has(messageId);
  }

  async markMessageProcessed(messageId: string): Promise<void> {
    this.inMemoryProcessed.add(messageId);
    if (this.inMemoryProcessed.size > 2000) {
      const first = this.inMemoryProcessed.values().next().value;
      if (first) this.inMemoryProcessed.delete(first);
    }
  }

  async getLatestPushTimestamp(): Promise<number | undefined> {
    const submissions = Object.values(this.state.submissions);
    if (submissions.length === 0) return undefined;
    const timestamps = submissions
      .map((s) => new Date(s.completedAt).getTime())
      .filter((t) => !isNaN(t));
    if (timestamps.length === 0) return undefined;
    return Math.floor(Math.max(...timestamps) / 1000);
  }

  async hasLocalDuplicate(_registrationNumber: string, _reportDate?: string): Promise<boolean> {
    return false;
  }
}
