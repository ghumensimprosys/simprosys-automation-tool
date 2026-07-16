/**
 * src/lib/auditEventBus.ts
 *
 * In-process pub/sub for audit SSE events. The audit pipeline emits events
 * here; the /api/audit/stream/[jobId] route subscribes and forwards them to
 * the client as Server-Sent Events.
 *
 * Uses the globalThis singleton so the Map survives Next.js HMR.
 * Listeners are cleaned up automatically when the stream closes.
 */

import type { AuditSSEEvent } from '@/types/audit';

type EventListener = (event: AuditSSEEvent) => void;

// ─── HMR-safe singleton ───────────────────────────────────────────────────────

const g = globalThis as Record<string, unknown>;
if (!g.__auditEventBus) g.__auditEventBus = new Map<string, Set<EventListener>>();
const bus = g.__auditEventBus as Map<string, Set<EventListener>>;

// ─── Publisher (called by audit pipeline) ────────────────────────────────────

export function emitEvent(jobId: string, event: AuditSSEEvent): void {
  const listeners = bus.get(jobId);
  if (!listeners) return;
  for (const fn of listeners) {
    try { fn(event); } catch { /* never let a broken listener crash the pipeline */ }
  }
}

// ─── Subscriber (called by SSE route) ────────────────────────────────────────

/**
 * Subscribe to events for a job. Returns an unsubscribe function.
 * Call unsubscribe() when the SSE connection closes.
 */
export function subscribe(jobId: string, listener: EventListener): () => void {
  if (!bus.has(jobId)) bus.set(jobId, new Set());
  bus.get(jobId)!.add(listener);

  return () => {
    const set = bus.get(jobId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) bus.delete(jobId);
    }
  };
}

/**
 * Create a ReadableStream that emits Server-Sent Events for the given jobId.
 * Automatically cleans up the subscription when the stream is cancelled.
 *
 * Each event is formatted as:
 *   data: <JSON>\n\n
 *
 * A keepalive comment `: ping\n\n` is sent every 15 seconds to prevent
 * proxy timeouts.
 */
export function createSseStream(jobId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const sendEvent = (event: AuditSSEEvent) => {
    if (!controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch { /* stream already closed */ }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      unsubscribe = subscribe(jobId, sendEvent);

      // Keepalive ping every 15 seconds
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          if (keepaliveTimer) clearInterval(keepaliveTimer);
        }
      }, 15_000);
    },

    cancel() {
      if (keepaliveTimer) clearInterval(keepaliveTimer);
      if (unsubscribe) unsubscribe();
      controllerRef = null;
    },
  });
}

// ─── Convenience: close a job's event stream ─────────────────────────────────

/**
 * Emit a final event and remove all listeners for the job.
 * Called by the pipeline after emitting 'complete' or 'error'.
 */
export function closeJobStream(jobId: string, finalEvent: AuditSSEEvent): void {
  emitEvent(jobId, finalEvent);
  bus.delete(jobId);
}
