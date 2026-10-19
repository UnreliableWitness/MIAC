import {
  ATTENTION_STATES,
  type AttentionSignal,
  type AttentionState,
  clampMessage,
} from '../../shared/attention';

export type ScanEvent =
  | { type: 'probe' }
  | { type: 'status'; fields: Record<string, string> }
  | { type: 'bell' };

const ESC = '\x1b';
const BEL = '\x07';
const CODE = '7501;';
const OSC_MAX = 8192;

/** What Shellie answers to Claude Code's "do you support program status?" probe. */
export const PROBE_REPLY = `${ESC}]7501;?${BEL}`;

/**
 * Finds OSC 7501 program status (probe and status) and bare BELs in a pty's output, keeping state between chunks.
 * Everything else passes by; nothing is removed from the stream.
 */
export class OscScanner {
  private mode: 'text' | 'esc' | 'osc' | 'osc-esc' | 'skip' | 'skip-esc' =
    'text';
  private osc = '';

  push(chunk: string): ScanEvent[] {
    const out: ScanEvent[] = [];
    for (const ch of chunk) {
      switch (this.mode) {
        case 'text':
          if (ch === ESC) this.mode = 'esc';
          else if (ch === BEL) out.push({ type: 'bell' });
          break;
        case 'esc':
          if (ch === ']') {
            this.mode = 'osc';
            this.osc = '';
          } else this.mode = ch === ESC ? 'esc' : 'text';
          break;
        case 'osc':
          if (ch === BEL) this.end(out);
          else if (ch === ESC) this.mode = 'osc-esc';
          else if (this.osc.length >= OSC_MAX) this.mode = 'skip';
          else this.osc += ch;
          break;
        // An over-long sequence: dropped up to its terminator, so its BEL is not taken for a bell.
        case 'skip':
          if (ch === BEL) this.mode = 'text';
          else if (ch === ESC) this.mode = 'skip-esc';
          break;
        case 'skip-esc':
          this.mode = ch === '\\' ? 'text' : 'skip';
          break;
        case 'osc-esc':
          if (ch === '\\') this.end(out);
          else if (ch === ']') {
            this.mode = 'osc';
            this.osc = '';
          } else this.mode = 'text';
          break;
      }
    }
    return out;
  }

  private end(out: ScanEvent[]): void {
    this.mode = 'text';
    const body = this.osc;
    this.osc = '';
    if (!body.startsWith(CODE)) return;
    const payload = body.slice(CODE.length);
    if (payload.startsWith('?')) {
      out.push({ type: 'probe' });
      return;
    }
    const fields: Record<string, string> = {};
    for (const part of payload.split(':')) {
      const eq = part.indexOf('=');
      if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
    }
    out.push({ type: 'status', fields });
  }
}

const decode = (b64: string | undefined): string | undefined => {
  if (!b64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(b64, 'base64'),
    );
    const line = clampMessage(text);
    return line === '' ? undefined : line;
  } catch {
    return undefined;
  }
};

/** A status sequence's fields as a signal; null when the state is missing or unknown. */
export function programStatusSignal(
  fields: Record<string, string>,
): AttentionSignal | null {
  const state = fields.state as AttentionState | undefined;
  if (!state || !ATTENTION_STATES.includes(state)) return null;
  const message = decode(fields.msg);
  return {
    state,
    ...(fields.kind ? { kind: fields.kind } : {}),
    ...(message ? { message } : {}),
  };
}
