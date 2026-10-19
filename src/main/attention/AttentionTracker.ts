import type {
  AttentionEntry,
  AttentionSignal,
  AttentionSnapshot,
  AttentionView,
} from '../../shared/attention';

type TrackerDeps = {
  now: () => number;
  notifyOnDone: () => boolean;
  onNotify: (terminalId: string, entry: AttentionEntry) => void;
  onDismiss: (terminalId: string) => void;
  onChange: (snapshot: AttentionSnapshot) => void;
};

/**
 * Which terminals wait on the developer. A terminal is on screen when the window is focused and it is the active
 * tab; signals for it are ignored and looking at it clears it. One notification per terminal until it was seen.
 */
export class AttentionTracker {
  private readonly entries = new Map<string, AttentionEntry>();
  private readonly notified = new Set<string>();
  private focused = false;
  private view: AttentionView = null;

  constructor(private readonly d: TrackerDeps) {}

  snapshot(): AttentionSnapshot {
    return Object.fromEntries(this.entries);
  }

  signal(terminalId: string, s: AttentionSignal): void {
    if (this.onScreen(terminalId)) return;
    const reason =
      s.state === 'blocked'
        ? 'blocked'
        : s.state === 'done' && this.d.notifyOnDone()
          ? 'done'
          : null;
    if (reason === null) {
      this.drop(terminalId);
      return;
    }
    const entry: AttentionEntry = {
      reason,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.message ? { message: s.message } : {}),
      since: this.entries.get(terminalId)?.since ?? this.d.now(),
    };
    this.entries.set(terminalId, entry);
    if (!this.notified.has(terminalId)) {
      this.notified.add(terminalId);
      this.d.onNotify(terminalId, entry);
    }
    this.d.onChange(this.snapshot());
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.seen();
  }

  setView(view: AttentionView): void {
    this.view = view;
    this.seen();
  }

  forget(terminalId: string): void {
    this.notified.delete(terminalId);
    this.drop(terminalId);
  }

  retain(ids: ReadonlySet<string>): void {
    for (const id of new Set([...this.entries.keys(), ...this.notified]))
      if (!ids.has(id)) this.forget(id);
  }

  private onScreen(terminalId: string): boolean {
    return this.focused && this.view?.tabId === terminalId;
  }

  private seen(): void {
    const id = this.focused ? this.view?.tabId : undefined;
    if (id !== undefined) this.forget(id);
  }

  private drop(terminalId: string): void {
    if (!this.entries.delete(terminalId)) return;
    this.d.onDismiss(terminalId);
    this.d.onChange(this.snapshot());
  }
}
