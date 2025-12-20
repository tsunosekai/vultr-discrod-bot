import { env } from "../config.js";

const BASE_URL = "https://api.vultr.com/v2";

interface VultrInstance {
  id: string;
  label: string;
  main_ip: string;
  status: string;
  power_status: string;
  server_status: string;
  region: string;
  plan: string;
}

interface VultrSnapshot {
  id: string;
  description: string;
  date_created: string;
  size: number;
  status: string;
}

interface ListInstancesResponse {
  instances: VultrInstance[];
}

interface ListSnapshotsResponse {
  snapshots: VultrSnapshot[];
}

interface CreateInstanceResponse {
  instance: VultrInstance;
}

interface CreateSnapshotResponse {
  snapshot: VultrSnapshot;
}

interface GetInstanceResponse {
  instance: VultrInstance;
}

interface GetSnapshotResponse {
  snapshot: VultrSnapshot;
}

async function vultrFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.vultrApiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vultr API error: ${response.status} - ${errorText}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export async function listInstances(): Promise<VultrInstance[]> {
  const data = await vultrFetch<ListInstancesResponse>("/instances");
  return data.instances;
}

export async function getInstance(instanceId: string): Promise<VultrInstance> {
  const data = await vultrFetch<GetInstanceResponse>(
    `/instances/${instanceId}`
  );
  return data.instance;
}

export async function findInstanceByLabel(
  label: string
): Promise<VultrInstance | undefined> {
  const instances = await listInstances();
  return instances.find((i) => i.label === label);
}

export async function createInstanceFromSnapshot(
  snapshotId: string,
  region: string,
  plan: string,
  label: string
): Promise<VultrInstance> {
  const data = await vultrFetch<CreateInstanceResponse>("/instances", {
    method: "POST",
    body: JSON.stringify({
      region,
      plan,
      snapshot_id: snapshotId,
      label,
    }),
  });
  return data.instance;
}

export async function deleteInstance(instanceId: string): Promise<void> {
  await vultrFetch(`/instances/${instanceId}`, {
    method: "DELETE",
  });
}

export async function listSnapshots(): Promise<VultrSnapshot[]> {
  const data = await vultrFetch<ListSnapshotsResponse>("/snapshots");
  return data.snapshots;
}

export async function getSnapshot(snapshotId: string): Promise<VultrSnapshot> {
  const data = await vultrFetch<GetSnapshotResponse>(
    `/snapshots/${snapshotId}`
  );
  return data.snapshot;
}

export async function findSnapshotsByPrefix(
  prefix: string
): Promise<VultrSnapshot[]> {
  const snapshots = await listSnapshots();
  return snapshots
    .filter((s) => s.description.startsWith(prefix))
    .sort(
      (a, b) =>
        new Date(b.date_created).getTime() - new Date(a.date_created).getTime()
    );
}

export async function createSnapshot(
  instanceId: string,
  description: string
): Promise<VultrSnapshot> {
  const data = await vultrFetch<CreateSnapshotResponse>("/snapshots", {
    method: "POST",
    body: JSON.stringify({
      instance_id: instanceId,
      description,
    }),
  });
  return data.snapshot;
}

export async function deleteSnapshot(snapshotId: string): Promise<void> {
  await vultrFetch(`/snapshots/${snapshotId}`, {
    method: "DELETE",
  });
}

export async function waitForInstanceReady(
  instanceId: string,
  timeoutMs: number = 300000
): Promise<VultrInstance> {
  const startTime = Date.now();
  const pollInterval = 5000;

  while (Date.now() - startTime < timeoutMs) {
    const instance = await getInstance(instanceId);
    if (
      instance.status === "active" &&
      instance.power_status === "running" &&
      instance.server_status === "ok"
    ) {
      return instance;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Timeout waiting for instance to become ready");
}

export async function waitForSnapshotReady(
  snapshotId: string,
  timeoutMs: number = 600000
): Promise<VultrSnapshot> {
  const startTime = Date.now();
  const pollInterval = 10000;

  while (Date.now() - startTime < timeoutMs) {
    const snapshot = await getSnapshot(snapshotId);
    if (snapshot.status === "complete") {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Timeout waiting for snapshot to complete");
}

export type { VultrInstance, VultrSnapshot };
