import { describe, expect, it, vi } from "vitest";
import { createEventBus, domainEvent, type DeploymentEvent } from "./events.js";

describe("createEventBus", () => {
  it("delivers published events to subscribers", () => {
    const bus = createEventBus();
    const subscriber = vi.fn();
    bus.subscribe(subscriber);

    const event: DeploymentEvent = domainEvent({
      type: "deployment.completed",
      deploymentId: "deploy-1",
      projectId: "project-1",
      version: 2,
      url: "https://site.example.test",
      sizeMb: 1.5,
    });
    bus.publish(event);

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(event);
  });

  it("isolates throwing subscribers from the publisher and other subscribers", () => {
    const bus = createEventBus();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    bus.subscribe(throwing);
    bus.subscribe(healthy);

    const event: DeploymentEvent = domainEvent({
      type: "deployment.failed",
      deploymentId: "deploy-1",
      projectId: "project-1",
      version: 1,
      error: "deploy failed",
    });

    expect(() => bus.publish(event)).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(throwing).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createEventBus();
    const subscriber = vi.fn();
    const unsubscribe = bus.subscribe(subscriber);

    const event: DeploymentEvent = domainEvent({
      type: "deployment.created",
      deploymentId: "deploy-1",
      projectId: "project-1",
      version: 1,
      trigger: "api",
    });
    bus.publish(event);
    unsubscribe();
    bus.publish(event);

    expect(subscriber).toHaveBeenCalledTimes(1);
  });
});

describe("domainEvent", () => {
  it("fills id and occurredAt", () => {
    const before = Date.now();
    const event = domainEvent({
      type: "rollback.completed",
      deploymentId: "deploy-1",
      projectId: "project-1",
      targetVersion: 1,
    });
    const after = Date.now();

    expect(event.id).toBeTruthy();
    expect(event.type).toBe("rollback.completed");
    expect(event.deploymentId).toBe("deploy-1");
    expect(new Date(event.occurredAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(event.occurredAt).getTime()).toBeLessThanOrEqual(after);
  });

  it("preserves caller-supplied id, occurredAt and correlationId", () => {
    const occurredAt = "2026-01-01T00:00:00.000Z";
    const event = domainEvent(
      {
        type: "deployment.requeued",
        deploymentId: "deploy-1",
        projectId: "project-1",
        version: 1,
        attempt: 2,
        error: "timeout",
      },
      { id: "custom-id", occurredAt },
    );

    expect(event.id).toBe("custom-id");
    expect(event.occurredAt).toBe(occurredAt);
  });
});
