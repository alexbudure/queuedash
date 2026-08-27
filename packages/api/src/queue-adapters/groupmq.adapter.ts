import {
  Job as GroupMQJobClass,
  type Job as GroupMQJob,
  type Queue as GroupMQQueue,
} from "groupmq";
import { parse } from "redis-info";

import {
  QueueAdapter,
  type AdaptedJob,
  type JobCounts,
  type FeatureSupport,
  type GroupInfo,
  type JobPageMeta,
  type JobScanToken,
} from "./base.adapter";

type GroupMQStatus = "waiting" | "active" | "completed" | "failed" | "delayed";

type GroupMQCleanableStatus = "completed" | "failed" | "delayed";

type WaitingCandidate = {
  groupId: string;
  id: string;
  rawOrdinal: number;
  score: number;
};

type WaitingSnapshot = {
  captureScanned: number;
  candidates: WaitingCandidate[];
  candidatesInspected: number;
  exhausted: boolean;
  jobs: AdaptedJob[];
  jobsOffset: number;
  lastAccessedAt: number;
  nextOffset: number;
  scanned: number;
};

const WAITING_SNAPSHOT_IDLE_TTL_MS = 60_000;
const WAITING_PAGE_LIMIT = 5_000;
const WAITING_SCAN_LIMIT = WAITING_PAGE_LIMIT + 1;
const WAITING_SNAPSHOT_RETAIN_BEHIND = 100;
const MAX_WAITING_GROUPS = WAITING_PAGE_LIMIT;
const MAX_INSPECTABLE_GROUPS = WAITING_PAGE_LIMIT;

// GroupMQ's public remove() intentionally deletes jobs in every state. Keep
// Queuedash's operator removal safe by combining the active-state check and
// removal into one Redis command, so a worker reservation cannot race between
// two separate calls.
const REMOVE_IF_NOT_ACTIVE_LUA = `
local ns = KEYS[1]
local jobId = ARGV[1]
local jobKey = ns .. ":job:" .. jobId
local processingKey = ns .. ":processing"
local stageKey = ns .. ":stage"

if redis.call("EXISTS", jobKey) == 0 then
  return 0
end

if redis.call("ZSCORE", processingKey, jobId) then
  return -1
end

local jobDetails = redis.call("HMGET", jobKey, "groupId", "status")
local groupId = jobDetails[1]
local jobStatus = jobDetails[2]
redis.call("ZREM", ns .. ":delayed", jobId)
local removedFromStage = redis.call("ZREM", stageKey, jobId)
redis.call("DEL", ns .. ":processing:" .. jobId)
redis.call("ZREM", ns .. ":completed", jobId)
redis.call("ZREM", ns .. ":failed", jobId)
redis.call("DEL", ns .. ":unique:" .. jobId)

if removedFromStage == 1 or jobStatus == "staged" then
  local nextStaged = redis.call("ZRANGE", stageKey, 0, 0, "WITHSCORES")
  if nextStaged and #nextStaged >= 2 then
    local redisTime = redis.call("TIME")
    local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
    redis.call(
      "SET",
      ns .. ":stage:timer",
      "1",
      "PX",
      math.max(1, tonumber(nextStaged[2]) - now)
    )
  else
    redis.call("DEL", ns .. ":stage:timer")
  end
end

if groupId then
  local groupKey = ns .. ":g:" .. groupId
  local groupActiveKey = groupKey .. ":active"
  redis.call("ZREM", groupKey, jobId)

  if redis.call("ZCARD", groupKey) == 0 then
    redis.call("ZREM", ns .. ":ready", groupId)

    local hasStagedJob = false
    local stagedJobs = redis.call("ZRANGE", stageKey, 0, 5000)
    if #stagedJobs > 5000 then
      hasStagedJob = true
    else
      for _, stagedJobId in ipairs(stagedJobs) do
        if redis.call("HGET", ns .. ":job:" .. stagedJobId, "groupId") == groupId then
          hasStagedJob = true
          break
        end
      end
    end

    if redis.call("LLEN", groupActiveKey) == 0 and not hasStagedJob then
      redis.call("DEL", groupKey)
      redis.call("DEL", groupActiveKey)
      redis.call("SREM", ns .. ":groups", groupId)
      redis.call("DEL", ns .. ":buffer:" .. groupId)
      redis.call("ZREM", ns .. ":buffering", groupId)
    end
  else
    local head = redis.call("ZRANGE", groupKey, 0, 0, "WITHSCORES")
    local headStatus = nil
    if head and #head >= 2 then
      headStatus = redis.call("HGET", ns .. ":job:" .. head[1], "status")
    end
    if
      head and
      #head >= 2 and
      headStatus == "waiting" and
      redis.call("LLEN", groupActiveKey) == 0
    then
      redis.call("ZADD", ns .. ":ready", tonumber(head[2]), groupId)
    else
      redis.call("ZREM", ns .. ":ready", groupId)
    end
  end
end

redis.call("DEL", jobKey)
return 1
`;

// Promotion has the same reservation race as removal. Only mutate when the
// job is still in GroupMQ's delayed set at the instant Redis executes this
// script.
const PROMOTE_IF_DELAYED_LUA = `
local ns = KEYS[1]
local jobId = ARGV[1]
local jobKey = ns .. ":job:" .. jobId
local delayedKey = ns .. ":delayed"

if redis.call("EXISTS", jobKey) == 0 then
  return 0
end

local groupId = redis.call("HGET", jobKey, "groupId")
if not groupId then
  return 0
end

if not redis.call("ZSCORE", delayedKey, jobId) then
  return -1
end

redis.call("HSET", jobKey, "delayUntil", "0", "status", "waiting")
redis.call("ZREM", delayedKey, jobId)

local groupKey = ns .. ":g:" .. groupId
local head = redis.call("ZRANGE", groupKey, 0, 0, "WITHSCORES")
if head and #head >= 2 and head[1] == jobId then
  redis.call("ZADD", ns .. ":ready", tonumber(head[2]), groupId)
end

return 1
`;

// Materialize a bounded, immutable view of the current waiting jobs in one
// Redis operation. GroupMQ accepts arbitrary ordering timestamps, while its
// job timestamp comes from the producer host, so neither score boundaries nor
// wall-clock comparisons can distinguish a backdated insertion reliably.
const CAPTURE_WAITING_SNAPSHOT_LUA = `
local ns = KEYS[1]
local rawLimit = tonumber(ARGV[1])
local validLimit = tonumber(ARGV[2])
local groupIds = redis.call("SMEMBERS", ns .. ":groups")
if #groupIds > ${MAX_WAITING_GROUPS} then
  return redis.error_reply("GroupMQ waiting pagination supports at most ${MAX_WAITING_GROUPS} groups per queue")
end

local function byteLess(left, right)
  local leftLength = string.len(left)
  local rightLength = string.len(right)
  local sharedLength = math.min(leftLength, rightLength)
  for index = 1, sharedLength do
    local leftByte = string.byte(left, index)
    local rightByte = string.byte(right, index)
    if leftByte ~= rightByte then
      return leftByte < rightByte
    end
  end
  return leftLength < rightLength
end

local function candidateLess(left, right)
  if left.score ~= right.score then
    return left.score < right.score
  end
  if left.groupId ~= right.groupId then
    return byteLess(left.groupId, right.groupId)
  end
  return byteLess(left.id, right.id)
end

local heap = {}

local function heapPush(candidate)
  local index = #heap + 1
  while index > 1 do
    local parentIndex = math.floor(index / 2)
    local parent = heap[parentIndex]
    if candidateLess(parent, candidate) then
      break
    end
    heap[index] = parent
    index = parentIndex
  end
  heap[index] = candidate
end

local function heapPop()
  local first = heap[1]
  local last = table.remove(heap)
  if #heap == 0 then
    return first
  end

  local index = 1
  while true do
    local leftIndex = index * 2
    if leftIndex > #heap then
      break
    end
    local rightIndex = leftIndex + 1
    local nextIndex = leftIndex
    if rightIndex <= #heap and candidateLess(heap[rightIndex], heap[leftIndex]) then
      nextIndex = rightIndex
    end
    if candidateLess(last, heap[nextIndex]) then
      break
    end
    heap[index] = heap[nextIndex]
    index = nextIndex
  end
  heap[index] = last
  return first
end

for _, groupId in ipairs(groupIds) do
  local groupKey = ns .. ":g:" .. groupId
  local head = redis.call("ZRANGE", groupKey, 0, 0, "WITHSCORES")
  if head and #head >= 2 then
    heapPush({
      groupId = groupId,
      id = head[1],
      rank = 0,
      score = tonumber(head[2]),
    })
  end
end

local inspected = 0
local captured = 0
local result = {"0", "0"}

while #heap > 0 and inspected < rawLimit and captured < validLimit do
  local candidate = heapPop()
  inspected = inspected + 1

  local nextRank = candidate.rank + 1
  local nextJob = redis.call(
    "ZRANGE",
    ns .. ":g:" .. candidate.groupId,
    nextRank,
    nextRank,
    "WITHSCORES"
  )
  if nextJob and #nextJob >= 2 then
    heapPush({
      groupId = candidate.groupId,
      id = nextJob[1],
      rank = nextRank,
      score = tonumber(nextJob[2]),
    })
  end

  local status = redis.call("HGET", ns .. ":job:" .. candidate.id, "status")
  local delayed = redis.call("ZSCORE", ns .. ":delayed", candidate.id)
  if status == "waiting" and not delayed then
    captured = captured + 1
    table.insert(result, candidate.groupId)
    table.insert(result, candidate.id)
    table.insert(result, tostring(candidate.score))
    table.insert(result, tostring(inspected))
  end
end

result[1] = tostring(inspected)
result[2] = #heap == 0 and "1" or "0"
return result
`;

const compareRedisMembers = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left), Buffer.from(right));

export class GroupMQAdapter extends QueueAdapter<
  GroupMQStatus,
  GroupMQCleanableStatus
> {
  private queue: GroupMQQueue;
  private waitingSnapshots = new Map<JobScanToken, WaitingSnapshot>();
  private waitingSnapshotExpiries = new Map<
    JobScanToken,
    ReturnType<typeof setTimeout>
  >();
  private waitingSnapshotTails = new Map<JobScanToken, Promise<void>>();
  private waitingScanLimits = new Map<JobScanToken, number>();
  private pageMeta = new WeakMap<AdaptedJob[], JobPageMeta>();

  supports: FeatureSupport<GroupMQStatus> = {
    addJobOptions: true,
    pause: true,
    resume: true,
    clean: false,
    discard: false,
    // GroupMQ's retry command increments attempts before rejecting exhausted
    // jobs. Retained failed jobs are already exhausted, so exposing retry
    // would be both ineffective and mutating.
    retry: false,
    promote: true,
    logs: false,
    schedulers: false,
    schedulerUpdate: false,
    flows: false,
    priorities: false,
    empty: false,
    metrics: false,
    statuses: ["waiting", "active", "completed", "failed", "delayed"],
    groups: true,
    workers: false,
  };

  constructor(
    queue: GroupMQQueue,
    displayName: string,
    jobNameFn?: (data: Record<string, unknown>) => string,
  ) {
    super(displayName, jobNameFn);
    this.queue = queue;
  }

  getName(): string {
    return this.queue.name;
  }

  getType(): "groupmq" {
    return "groupmq";
  }

  beginJobScan(
    status: GroupMQStatus,
    scanLimit = WAITING_SCAN_LIMIT,
  ): JobScanToken | undefined {
    if (status !== "waiting") return undefined;
    const scanToken = Symbol("groupmq-waiting-scan");
    this.waitingScanLimits.set(
      scanToken,
      Math.min(Math.max(Math.floor(scanLimit), 1), WAITING_SCAN_LIMIT),
    );
    return scanToken;
  }

  endJobScan(scanToken: JobScanToken): void {
    const expiry = this.waitingSnapshotExpiries.get(scanToken);
    if (expiry) clearTimeout(expiry);
    this.waitingSnapshotExpiries.delete(scanToken);
    this.waitingSnapshots.delete(scanToken);
    this.waitingSnapshotTails.delete(scanToken);
    this.waitingScanLimits.delete(scanToken);
  }

  async getJobCounts(): Promise<JobCounts> {
    const counts = await this.queue.getJobCounts();
    return {
      active: counts.active,
      // GroupMQ keeps delayed jobs inside their group ZSETs, so its native
      // waiting count includes every delayed job as well.
      waiting: Math.max(0, counts.waiting - counts.delayed),
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      paused: counts.paused || 0,
      prioritized: counts.prioritized || 0,
    };
  }

  async isPaused(): Promise<boolean> {
    return this.queue.isPaused();
  }

  async pause(): Promise<void> {
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    await this.queue.resume();
  }

  async empty(): Promise<void> {
    // GroupMQ doesn't have empty/drain, throw error
    throw new Error("GroupMQ does not support emptying queues");
  }

  async clean(status: GroupMQCleanableStatus, graceMs: number): Promise<void> {
    void status;
    void graceMs;
    throw new Error("GroupMQ does not support verifiable queue cleaning");
  }

  async getRedisInfo() {
    const info = parse(await this.queue.redis.info());
    return {
      ...info,
      maxclients: (info as unknown as Record<string, string>).maxclients || "0",
    };
  }

  async getJobs(
    status: GroupMQStatus,
    start: number,
    end: number,
    scanLimit?: number,
    scanToken?: JobScanToken,
  ): Promise<AdaptedJob[]> {
    const namespace = this.queue.namespace;
    let jobIds: string[];

    switch (status) {
      case "active":
        jobIds = await this.queue.redis.zrange(
          `${namespace}:processing`,
          start,
          end,
        );
        break;
      case "delayed":
        jobIds = await this.queue.redis.zrange(
          `${namespace}:delayed`,
          start,
          end,
        );
        break;
      case "completed":
      case "failed":
        jobIds = await this.queue.redis.zrevrange(
          `${namespace}:${status}`,
          start,
          end,
        );
        break;
      case "waiting":
        return this.getWaitingJobsPage(start, end, scanLimit, scanToken);
    }

    const jobs = await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          return await this.queue.getJob(jobId);
        } catch (error) {
          if (error instanceof Error && /not found/i.test(error.message)) {
            return null;
          }
          throw error;
        }
      }),
    );
    const adapted = jobs
      .filter((job): job is GroupMQJob => job !== null)
      .map((job) => this.adaptJob(job));
    const requested = end - start + 1;
    this.pageMeta.set(adapted, {
      capped: false,
      cursorAdvance: requested,
      exhausted: jobIds.length < requested,
      scanned: start + jobIds.length,
      scanLimit: scanLimit ?? Math.max(end + 1, 1),
    });
    return adapted;
  }

  async getJob(jobId: string): Promise<AdaptedJob | null> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return null;
      return this.adaptJob(job);
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async getJobStatus(jobId: string): Promise<GroupMQStatus | null> {
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return null;
      const pipeline = this.queue.redis.pipeline();
      pipeline.zscore(`${this.queue.namespace}:processing`, jobId);
      pipeline.zscore(`${this.queue.namespace}:delayed`, jobId);
      pipeline.zscore(`${this.queue.namespace}:completed`, jobId);
      pipeline.zscore(`${this.queue.namespace}:failed`, jobId);
      pipeline.zscore(`${this.queue.namespace}:g:${job.groupId}`, jobId);
      pipeline.hget(`${this.queue.namespace}:job:${jobId}`, "status");
      const rows = await pipeline.exec();
      if (!rows || rows.length !== 6) {
        throw new Error("GroupMQ job status returned incomplete Redis data");
      }
      for (const row of rows) {
        if (row[0]) throw row[0];
      }
      if (rows[0]?.[1] !== null) return "active";
      if (rows[1]?.[1] !== null) return "delayed";
      if (rows[2]?.[1] !== null) return "completed";
      if (rows[3]?.[1] !== null) return "failed";
      if (rows[4]?.[1] !== null) {
        // Auto-batched jobs can enter the group ZSET while their persisted
        // status is still "staged". Do not expose those jobs as waiting via
        // the exact-ID search path.
        return rows[5]?.[1] === "waiting" ? "waiting" : null;
      }
      const status = await job.getState();
      return this.supportsStatus(status as GroupMQStatus)
        ? (status as GroupMQStatus)
        : null;
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  async addJob(
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ): Promise<AdaptedJob> {
    const { groupId: requestedGroupId, ...jobOptions } = opts ?? {};
    delete jobOptions.data;
    const job = await this.queue.add({
      ...jobOptions,
      groupId:
        (typeof requestedGroupId === "string" && requestedGroupId) ||
        Math.random().toString(36).substring(2, 15),
      data,
    });
    return this.adaptJob(job);
  }

  async removeJob(jobId: string): Promise<void> {
    const result = Number(
      await this.queue.redis.eval(
        REMOVE_IF_NOT_ACTIVE_LUA,
        1,
        this.queue.namespace,
        jobId,
      ),
    );
    if (result === -1) {
      throw new Error("GroupMQ cannot safely remove an active job");
    }
    if (result !== 1) {
      throw new Error(`GroupMQ could not remove job "${jobId}"`);
    }
  }

  async retryJob(): Promise<void> {
    throw new Error("GroupMQ does not support safely retrying failed jobs");
  }

  async promoteJob(jobId: string): Promise<void> {
    const result = Number(
      await this.queue.redis.eval(
        PROMOTE_IF_DELAYED_LUA,
        1,
        this.queue.namespace,
        jobId,
      ),
    );
    if (result === -1) {
      throw new Error(`GroupMQ job "${jobId}" is no longer delayed`);
    }
    if (result !== 1) {
      throw new Error(`GroupMQ could not promote job "${jobId}"`);
    }
  }

  async discardJob(jobId: string): Promise<void> {
    void jobId;
    throw new Error("GroupMQ does not support discarding jobs");
  }

  async getJobLogs(): Promise<string[] | null> {
    return null; // GroupMQ doesn't support job logs
  }

  private adaptJob(job: GroupMQJob): AdaptedJob {
    const jobName = this.getJobName(
      job.data as Record<string, unknown>,
      job.groupId || "Default",
    );

    return {
      id: job.id,
      name: jobName,
      data: job.data,
      opts: (job.opts || {}) as Record<string, unknown>,
      createdAt: job.timestamp ? new Date(job.timestamp) : new Date(),
      processedAt: job.processedOn ? new Date(job.processedOn) : null,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : null,
      failedReason: job.failedReason,
      stacktrace:
        typeof job.stacktrace === "string" && job.stacktrace
          ? [job.stacktrace]
          : [],
      retriedAt: null,
      returnValue: job.returnvalue,
      groupId: job.groupId,
      attemptsMade: job.attemptsMade,
    };
  }

  private async readWaitingJobs(
    candidates: WaitingCandidate[],
  ): Promise<AdaptedJob[]> {
    if (candidates.length === 0) return [];

    const pipeline = this.queue.redis.pipeline();
    for (const candidate of candidates) {
      pipeline.hgetall(`${this.queue.namespace}:job:${candidate.id}`);
      pipeline.zscore(`${this.queue.namespace}:delayed`, candidate.id);
      pipeline.zscore(
        `${this.queue.namespace}:g:${candidate.groupId}`,
        candidate.id,
      );
    }
    const rows = await pipeline.exec();
    if (!rows || rows.length !== candidates.length * 3) {
      throw new Error("GroupMQ waiting jobs returned incomplete Redis data");
    }
    const jobs: AdaptedJob[] = [];

    for (let index = 0; index < candidates.length; index += 1) {
      const hashError = rows?.[index * 3]?.[0];
      const delayedLookupError = rows?.[index * 3 + 1]?.[0];
      const groupLookupError = rows?.[index * 3 + 2]?.[0];
      if (hashError) throw hashError;
      if (delayedLookupError) throw delayedLookupError;
      if (groupLookupError) throw groupLookupError;
      const raw = rows?.[index * 3]?.[1] as Record<string, string> | undefined;
      const delayedScore = rows?.[index * 3 + 1]?.[1];
      const groupScore = rows?.[index * 3 + 2]?.[1];
      if (
        !raw ||
        Object.keys(raw).length === 0 ||
        raw.status !== "waiting" ||
        delayedScore !== null ||
        groupScore === null
      ) {
        continue;
      }
      const job = GroupMQJobClass.fromRawHash(
        this.queue,
        candidates[index].id,
        raw,
        "waiting",
      );
      jobs.push(this.adaptJob(job));
    }

    return jobs;
  }

  private touchWaitingSnapshot(
    snapshotKey: JobScanToken,
    snapshot: WaitingSnapshot,
  ): void {
    snapshot.lastAccessedAt = Date.now();
    if (this.waitingSnapshots.get(snapshotKey) !== snapshot) return;

    const existing = this.waitingSnapshotExpiries.get(snapshotKey);
    if (existing) clearTimeout(existing);
    const expiry = setTimeout(() => {
      if (this.waitingSnapshots.get(snapshotKey) === snapshot) {
        this.waitingSnapshots.delete(snapshotKey);
      }
      this.waitingSnapshotExpiries.delete(snapshotKey);
    }, WAITING_SNAPSHOT_IDLE_TTL_MS);
    expiry.unref?.();
    this.waitingSnapshotExpiries.set(snapshotKey, expiry);
  }

  private async createWaitingSnapshot(
    rawLimit: number,
    validLimit: number,
  ): Promise<WaitingSnapshot> {
    const groupCount = await this.queue.redis.scard(
      `${this.queue.namespace}:groups`,
    );
    if (groupCount > MAX_WAITING_GROUPS) {
      throw new Error(
        `GroupMQ waiting pagination supports at most ${MAX_WAITING_GROUPS.toLocaleString()} groups per queue`,
      );
    }

    const capturedValues = (await this.queue.redis.eval(
      CAPTURE_WAITING_SNAPSHOT_LUA,
      1,
      this.queue.namespace,
      rawLimit,
      validLimit,
    )) as string[];
    if (
      !Array.isArray(capturedValues) ||
      capturedValues.length < 2 ||
      (capturedValues.length - 2) % 4 !== 0
    ) {
      throw new Error(
        "GroupMQ waiting snapshot returned incomplete Redis data",
      );
    }

    const captureScanned = Number(capturedValues[0]);
    const exhausted = capturedValues[1] === "1";
    if (!Number.isSafeInteger(captureScanned) || captureScanned < 0) {
      throw new Error(
        "GroupMQ waiting snapshot returned invalid scan metadata",
      );
    }

    const candidates: WaitingCandidate[] = [];
    for (let index = 2; index < capturedValues.length; index += 4) {
      const groupId = capturedValues[index];
      const id = capturedValues[index + 1];
      const score = Number(capturedValues[index + 2]);
      const rawOrdinal = Number(capturedValues[index + 3]);
      if (
        !groupId ||
        !id ||
        !Number.isFinite(score) ||
        !Number.isSafeInteger(rawOrdinal) ||
        rawOrdinal < 1 ||
        rawOrdinal > captureScanned ||
        rawOrdinal <= (candidates.at(-1)?.rawOrdinal ?? 0)
      ) {
        throw new Error(
          "GroupMQ waiting snapshot returned invalid candidate data",
        );
      }
      candidates.push({ groupId, id, rawOrdinal, score });
    }

    const createdAt = Date.now();
    return {
      captureScanned,
      candidates,
      candidatesInspected: 0,
      exhausted,
      jobs: [],
      jobsOffset: 0,
      lastAccessedAt: createdAt,
      nextOffset: 0,
      scanned: 0,
    };
  }

  private async getWaitingJobsPage(
    start: number,
    end: number,
    scanLimit = WAITING_SCAN_LIMIT,
    scanToken?: JobScanToken,
  ): Promise<AdaptedJob[]> {
    const persistentSnapshot = scanToken !== undefined;
    const snapshotKey = scanToken ?? Symbol("groupmq-waiting-page");
    const requestedScanLimit = Math.min(
      Math.max(Math.floor(scanLimit), 1),
      WAITING_SCAN_LIMIT,
    );
    const snapshotRawLimit = scanToken
      ? (this.waitingScanLimits.get(scanToken) ?? requestedScanLimit)
      : requestedScanLimit;
    const snapshotValidLimit = persistentSnapshot
      ? snapshotRawLimit
      : Math.min(end + 1, snapshotRawLimit);
    const precedingRequest =
      this.waitingSnapshotTails.get(snapshotKey) ?? Promise.resolve();
    let releaseRequest = () => {};
    const requestTail = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    this.waitingSnapshotTails.set(snapshotKey, requestTail);
    await precedingRequest;

    const existingExpiry = this.waitingSnapshotExpiries.get(snapshotKey);
    if (existingExpiry) {
      clearTimeout(existingExpiry);
      this.waitingSnapshotExpiries.delete(snapshotKey);
    }
    try {
      return await this.getWaitingJobsPageUnlocked(
        snapshotKey,
        start,
        end,
        requestedScanLimit,
        snapshotRawLimit,
        snapshotValidLimit,
      );
    } finally {
      const snapshot = this.waitingSnapshots.get(snapshotKey);
      if (persistentSnapshot && snapshot) {
        this.touchWaitingSnapshot(snapshotKey, snapshot);
      } else {
        this.waitingSnapshots.delete(snapshotKey);
      }
      releaseRequest();
      if (this.waitingSnapshotTails.get(snapshotKey) === requestTail) {
        this.waitingSnapshotTails.delete(snapshotKey);
      }
    }
  }

  private async getWaitingJobsPageUnlocked(
    snapshotKey: JobScanToken,
    start: number,
    end: number,
    scanLimit: number,
    snapshotRawLimit: number,
    snapshotValidLimit: number,
  ): Promise<AdaptedJob[]> {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error("GroupMQ waiting pagination requires integer offsets");
    }
    if (end > WAITING_PAGE_LIMIT) {
      throw new Error(
        `GroupMQ waiting-job pagination is limited to the first ${WAITING_PAGE_LIMIT.toLocaleString()} jobs`,
      );
    }
    const candidateScanLimit = Math.min(
      Math.max(Math.floor(scanLimit), 1),
      WAITING_SCAN_LIMIT,
    );

    const now = Date.now();
    let snapshot = this.waitingSnapshots.get(snapshotKey);
    if (
      !snapshot ||
      now - snapshot.lastAccessedAt > WAITING_SNAPSHOT_IDLE_TTL_MS ||
      start < snapshot.jobsOffset
    ) {
      snapshot = await this.createWaitingSnapshot(
        snapshotRawLimit,
        snapshotValidLimit,
      );
      this.waitingSnapshots.set(snapshotKey, snapshot);
    }
    snapshot.lastAccessedAt = Date.now();

    if (start > snapshot.nextOffset + WAITING_PAGE_LIMIT) {
      throw new Error(
        `GroupMQ waiting cursor may advance by at most ${WAITING_PAGE_LIMIT.toLocaleString()} jobs per request`,
      );
    }

    const retainFrom = Math.max(0, start - WAITING_SNAPSHOT_RETAIN_BEHIND);
    if (retainFrom > snapshot.jobsOffset) {
      const discardCount = Math.min(
        retainFrom - snapshot.jobsOffset,
        snapshot.jobs.length,
      );
      snapshot.jobs.splice(0, discardCount);
      snapshot.jobsOffset += discardCount;
    }

    while (snapshot.nextOffset <= end) {
      const nextCandidate = snapshot.candidates[snapshot.candidatesInspected];
      if (!nextCandidate || nextCandidate.rawOrdinal > candidateScanLimit) {
        break;
      }
      const neededJobs = end - snapshot.nextOffset + 1;
      const batchStart = snapshot.candidatesInspected;
      let batchEnd = batchStart;
      while (
        batchEnd < snapshot.candidates.length &&
        batchEnd - batchStart < Math.max(neededJobs, 1) &&
        snapshot.candidates[batchEnd].rawOrdinal <= candidateScanLimit
      ) {
        batchEnd += 1;
      }
      const candidates = snapshot.candidates.slice(batchStart, batchEnd);
      snapshot.candidatesInspected = batchEnd;
      snapshot.scanned = Math.max(
        snapshot.scanned,
        candidates.at(-1)?.rawOrdinal ?? 0,
      );
      const jobs = await this.readWaitingJobs(candidates);

      for (const job of jobs) {
        const jobOffset = snapshot.nextOffset;
        snapshot.nextOffset += 1;
        if (jobOffset < retainFrom) {
          snapshot.jobsOffset = snapshot.nextOffset;
        } else {
          snapshot.jobs.push(job);
        }
      }
    }

    const nextCapturedCandidate =
      snapshot.candidates[snapshot.candidatesInspected];
    const knownThrough = nextCapturedCandidate
      ? nextCapturedCandidate.rawOrdinal - 1
      : snapshot.captureScanned;
    snapshot.scanned = Math.max(
      snapshot.scanned,
      Math.min(candidateScanLimit, knownThrough),
    );

    const relativeStart = Math.max(0, start - snapshot.jobsOffset);
    const relativeEnd = Math.max(relativeStart, end - snapshot.jobsOffset + 1);
    const page = snapshot.jobs.slice(relativeStart, relativeEnd);
    const inspectedSnapshot =
      snapshot.candidatesInspected >= snapshot.candidates.length;
    const exhausted =
      snapshot.exhausted &&
      inspectedSnapshot &&
      snapshot.scanned >= snapshot.captureScanned;
    snapshot.lastAccessedAt = Date.now();
    this.pageMeta.set(page, {
      capped: !exhausted && snapshot.scanned >= candidateScanLimit,
      cursorAdvance: page.length,
      exhausted,
      scanned: Math.min(snapshot.scanned, candidateScanLimit),
      scanLimit: candidateScanLimit,
    });
    return page;
  }

  getJobPageMeta(jobs: AdaptedJob[]): JobPageMeta | undefined {
    return this.pageMeta.get(jobs);
  }

  async getGroups(): Promise<GroupInfo[]> {
    const groupsKey = `${this.queue.namespace}:groups`;
    const groupCount = await this.queue.redis.scard(groupsKey);
    if (groupCount > MAX_INSPECTABLE_GROUPS) {
      throw new Error(
        `GroupMQ group inspection supports at most ${MAX_INSPECTABLE_GROUPS.toLocaleString()} groups per queue`,
      );
    }

    const groupIds = (await this.queue.redis.smembers(groupsKey)).sort(
      compareRedisMembers,
    );
    if (groupIds.length > MAX_INSPECTABLE_GROUPS) {
      throw new Error(
        `GroupMQ group inspection supports at most ${MAX_INSPECTABLE_GROUPS.toLocaleString()} groups per queue`,
      );
    }
    if (groupIds.length === 0) return [];

    const pipeline = this.queue.redis.pipeline();
    for (const id of groupIds) {
      pipeline.zcard(`${this.queue.namespace}:g:${id}`);
    }
    const rows = await pipeline.exec();
    if (!rows || rows.length !== groupIds.length) {
      throw new Error(
        "GroupMQ group inspection returned incomplete Redis data",
      );
    }
    for (const row of rows) {
      if (row[0]) throw row[0];
    }

    return groupIds.map((id, index) => ({
      id,
      count: Number(rows[index]?.[1] ?? 0),
      status: "active" as const,
    }));
  }
}
