export type ClientMessage =
  | { type: 'subscribe'; viewId: string }
  | { type: 'unsubscribe'; viewId: string }
  /** Tab is going away. Drop all subscriptions for this port. */
  | { type: 'leave' }

export type WorkerMessage =
  | { type: 'render'; viewId: string; html: string }
  | { type: 'error'; viewId?: string; message: string }
