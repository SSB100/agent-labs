import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DurableSimulationRun } from "./durable-simulation";

export type SimulationControl = {
  id: string;
  action: "pause" | "cancel";
  reason: string;
  requestedAt: string;
};

export class SimulationRunBusyError extends Error {
  constructor() {
    super("Simulation run is locked by another invocation. A lock left by an abruptly terminated process must be inspected and removed by the local operator before retrying; it is never automatically stolen.");
    this.name = "SimulationRunBusyError";
  }
}

/** All mutations of a run must hold its exclusive lock. Controls are a separate append-only inbox. */
export interface SimulationRepository {
  read(runKey: string): DurableSimulationRun | null;
  save(run: DurableSimulationRun): void;
  controls(runKey: string): SimulationControl[];
  requestControl(runKey: string, control: SimulationControl): void;
  withRunLock<T>(runKey: string, action: () => Promise<T>): Promise<T>;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateRunKey(runKey: string) {
  if (typeof runKey !== "string" || !runKey.trim() || runKey.length > 200) throw new Error("A non-empty runKey of at most 200 characters is required.");
}

/**
 * Single-machine JSON persistence, not a hosted workflow engine. Atomic rename and fsync
 * make each run/event/receipt checkpoint durable; exclusive locks fail closed on crashes.
 * Never put this directory on a shared network filesystem or manually remove an active lock.
 */
export class FileSimulationRepository implements SimulationRepository {
  readonly directory: string;
  private readonly held = new Set<string>();

  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  private file(runKey: string, suffix: string): string {
    validateRunKey(runKey);
    return join(this.directory, `${digest(runKey)}${suffix}`);
  }

  private atomicWrite(path: string, value: unknown): void {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(value));
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    try {
      renameSync(temporary, path);
      const parent = openSync(this.directory, "r");
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }

  read(runKey: string): DurableSimulationRun | null {
    const path = this.file(runKey, ".json");
    if (!existsSync(path)) return null;
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    if (envelope.version !== 1 || typeof envelope.payload !== "string" || envelope.checksum !== digest(envelope.payload)) throw new Error("Simulation checkpoint integrity check failed.");
    const run = JSON.parse(envelope.payload) as DurableSimulationRun;
    if (run.runKey !== runKey || run.mode !== "simulation" || run.schemaVersion !== 1) throw new Error("Simulation checkpoint identity is invalid.");
    return run;
  }

  save(run: DurableSimulationRun): void {
    if (!this.held.has(run.runKey)) throw new Error("Simulation writes require the exclusive run lock.");
    const payload = JSON.stringify(run);
    this.atomicWrite(this.file(run.runKey, ".json"), { version: 1, checksum: digest(payload), payload });
  }

  controls(runKey: string): SimulationControl[] {
    const prefix = `${digest(runKey)}.control.`;
    return readdirSync(this.directory).filter(name => name.startsWith(prefix) && name.endsWith(".json"))
      .map(name => JSON.parse(readFileSync(join(this.directory, name), "utf8")) as SimulationControl)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.id.localeCompare(right.id));
  }

  requestControl(runKey: string, control: SimulationControl): void {
    if (!this.read(runKey)) throw new Error("Simulation run does not exist.");
    if (!/^[a-z0-9-]+$/i.test(control.id) || !["pause", "cancel"].includes(control.action)) throw new Error("Invalid simulation control.");
    this.atomicWrite(this.file(runKey, `.control.${control.id}.json`), control);
  }

  async withRunLock<T>(runKey: string, action: () => Promise<T>): Promise<T> {
    const path = this.file(runKey, ".lock");
    let descriptor: number;
    try { descriptor = openSync(path, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SimulationRunBusyError();
      throw error;
    }
    try {
      writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: new Date().toISOString() }));
      fsyncSync(descriptor);
      this.held.add(runKey);
      return await action();
    } finally {
      this.held.delete(runKey);
      closeSync(descriptor);
      unlinkSync(path);
    }
  }
}

/** Test double preserving the same exclusivity and copy-on-read/write semantics. */
export class MemorySimulationRepository implements SimulationRepository {
  private readonly runs = new Map<string, DurableSimulationRun>();
  private readonly inbox = new Map<string, SimulationControl[]>();
  private readonly held = new Set<string>();

  read(runKey: string): DurableSimulationRun | null { return structuredClone(this.runs.get(runKey) ?? null); }
  save(run: DurableSimulationRun): void {
    if (!this.held.has(run.runKey)) throw new Error("Simulation writes require the exclusive run lock.");
    this.runs.set(run.runKey, structuredClone(run));
  }
  controls(runKey: string): SimulationControl[] { return structuredClone(this.inbox.get(runKey) ?? []); }
  requestControl(runKey: string, control: SimulationControl): void {
    if (!this.runs.has(runKey)) throw new Error("Simulation run does not exist.");
    this.inbox.set(runKey, [...(this.inbox.get(runKey) ?? []), structuredClone(control)]);
  }
  async withRunLock<T>(runKey: string, action: () => Promise<T>): Promise<T> {
    validateRunKey(runKey);
    if (this.held.has(runKey)) throw new SimulationRunBusyError();
    this.held.add(runKey);
    try { return await action(); } finally { this.held.delete(runKey); }
  }
}
