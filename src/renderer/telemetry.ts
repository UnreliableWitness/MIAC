import type { RendererTelemetry, TelemetryProps } from '../shared/telemetry';

/** Never throws: telemetry must not break the UI (or tests without a preload). */
function send(message: RendererTelemetry): void {
  try {
    window.shellie?.track?.(message);
  } catch {
    // ignore
  }
}

/** A named feature event with small, non-identifying properties. See docs/telemetry.md. */
export function track(name: string, props?: TelemetryProps): void {
  send({ type: 'event', name, props });
}

export function trackScreen(name: string, props?: TelemetryProps): void {
  send({ type: 'pageView', name, props });
}

export function trackError(error: unknown, props?: TelemetryProps): void {
  const e =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'Non-error rejection');
  send({
    type: 'exception',
    errorType: (e.name || 'Error').slice(0, 80),
    message: e.message.slice(0, 2000),
    stack: e.stack?.slice(0, 8000),
    props,
  });
}

/** Reports uncaught renderer errors and unhandled rejections. Call once at startup. */
export function installErrorTracking(target: Window = window): void {
  target.addEventListener('error', (ev) =>
    trackError(ev.error ?? ev.message, { source: 'window.onerror' }),
  );
  target.addEventListener('unhandledrejection', (ev) =>
    trackError(ev.reason, { source: 'unhandledrejection' }),
  );
}
