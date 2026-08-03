/**
 * Internal domain events. The worker publishes lifecycle events through an
 * in-process EventBus; future systems (notifications, analytics, webhooks)
 * subscribe without the publisher knowing about them. Events carry an `id`
 * (correlation across retries), `occurredAt` timestamp and an optional
 * `correlationId` that ties them to a user request or worker job.
 */

export interface DomainEventBase {
  id: string;
  occurredAt: string;
  correlationId?: string;
}

export type DeploymentEvent =
  | (DomainEventBase & {
      type: "deployment.created";
      deploymentId: string;
      projectId: string;
      version: number;
      trigger: string;
    })
  | (DomainEventBase & {
      type: "deployment.completed";
      deploymentId: string;
      projectId: string;
      version: number;
      url: string;
      sizeMb: number;
    })
  | (DomainEventBase & {
      type: "deployment.failed";
      deploymentId: string;
      projectId: string;
      version: number;
      error: string;
    })
  | (DomainEventBase & {
      type: "deployment.requeued";
      deploymentId: string;
      projectId: string;
      version: number;
      attempt: number;
      error: string;
    })
  | (DomainEventBase & {
      type: "rollback.completed";
      deploymentId: string;
      projectId: string;
      targetVersion: number;
    })
  | (DomainEventBase & {
      type: "rollback.failed";
      deploymentId: string;
      projectId: string;
      targetVersion: number;
      error: string;
    });

export type DomainEvent = DeploymentEvent;
export type DomainEventType = DomainEvent["type"];

export interface DomainEventSubscriber {
  (event: DomainEvent): void;
}

export interface EventBus {
  publish(event: DomainEvent): void;
  subscribe(subscriber: DomainEventSubscriber): () => void;
}

/**
 * Creates a minimal in-process publish/subscribe bus. Subscribers are isolated:
 * a throwing subscriber never breaks the publisher or other subscribers.
 */
export function createEventBus(): EventBus {
  const subscribers = new Set<DomainEventSubscriber>();
  return {
    publish(event: DomainEvent): void {
      for (const subscriber of [...subscribers]) {
        try {
          subscriber(event);
        } catch {
          // Subscribers must not affect the publisher.
        }
      }
    },
    subscribe(subscriber: DomainEventSubscriber): () => void {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };
}

/**
 * Fills the base fields (`id`, `occurredAt`) for an event. The caller supplies
 * the payload-specific fields and optionally a correlationId.
 */
export function domainEvent<E extends Omit<DomainEvent, "id" | "occurredAt">>(
  event: E,
  context: { id?: string; occurredAt?: string } = {},
): E & DomainEventBase {
  return {
    ...event,
    id:
      context.id ??
      `${event.type}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`,
    occurredAt: context.occurredAt ?? new Date().toISOString(),
  };
}
