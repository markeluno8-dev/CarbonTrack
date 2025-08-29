// CaptureRegistry.test.ts
import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface CaptureEntry {
  hash: Uint8Array; // Represent buff 32 as Uint8Array
  owner: string;
  timestamp: number;
  volume: number;
  method: string;
  location: string;
  metadata: string;
}

interface VersionEntry {
  updatedHash: Uint8Array;
  updateNotes: string;
  timestamp: number;
}

interface TagsEntry {
  tags: string[];
}

interface CollaboratorEntry {
  role: string;
  permissions: string[];
  addedAt: number;
}

interface StatusEntry {
  status: string;
  visibility: boolean;
  lastUpdated: number;
}

interface ContractState {
  captureRegistry: Map<number, CaptureEntry>;
  captureHashes: Map<string, { captureId: number }>; // Use string for hash key (hex string)
  captureVersions: Map<string, VersionEntry>; // Key as `${captureId}-${version}`
  captureTags: Map<number, TagsEntry>;
  collaborators: Map<string, CollaboratorEntry>; // Key as `${captureId}-${collaborator}`
  captureStatus: Map<number, StatusEntry>;
  nextCaptureId: number;
  blockHeight: number; // Mock block height
}

// Mock contract implementation
class CaptureRegistryMock {
  private state: ContractState = {
    captureRegistry: new Map(),
    captureHashes: new Map(),
    captureVersions: new Map(),
    captureTags: new Map(),
    collaborators: new Map(),
    captureStatus: new Map(),
    nextCaptureId: 1,
    blockHeight: 1000,
  };

  private ERR_ALREADY_REGISTERED = 100;
  private ERR_UNAUTHORIZED = 101;
  private ERR_INVALID_HASH = 102;
  private ERR_INVALID_METADATA = 103;
  private ERR_INVALID_VOLUME = 104;
  private ERR_NOT_FOUND = 106;
  private ERR_MAX_VERSIONS_REACHED = 107;
  private ERR_INVALID_STATUS = 108;
  private ERR_METADATA_TOO_LONG = 109;
  private MAX_METADATA_LEN = 1000;
  private MAX_VERSIONS = 5;

  // Helper to simulate buff 32 as Uint8Array, but use hex string for maps
  private buffToKey(buff: Uint8Array): string {
    return Array.from(buff).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Mock block-height
  private getBlockHeight(): number {
    return this.state.blockHeight++;
  }

  registerCapture(
    caller: string,
    hash: Uint8Array,
    volume: number,
    method: string,
    location: string,
    metadata: string
  ): ClarityResponse<number> {
    if (hash.length === 0) return { ok: false, value: this.ERR_INVALID_HASH };
    if (volume <= 0) return { ok: false, value: this.ERR_INVALID_VOLUME };
    if (metadata.length > this.MAX_METADATA_LEN) return { ok: false, value: this.ERR_METADATA_TOO_LONG };

    const hashKey = this.buffToKey(hash);
    if (this.state.captureHashes.has(hashKey)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }

    const captureId = this.state.nextCaptureId++;
    const timestamp = this.getBlockHeight();

    this.state.captureRegistry.set(captureId, {
      hash,
      owner: caller,
      timestamp,
      volume,
      method,
      location,
      metadata,
    });

    this.state.captureHashes.set(hashKey, { captureId });

    this.state.captureStatus.set(captureId, {
      status: "pending",
      visibility: true,
      lastUpdated: timestamp,
    });

    return { ok: true, value: captureId };
  }

  addVersion(
    caller: string,
    captureId: number,
    newHash: Uint8Array,
    notes: string
  ): ClarityResponse<number> {
    const registration = this.state.captureRegistry.get(captureId);
    if (!registration) return { ok: false, value: this.ERR_NOT_FOUND };

    // Mock is-owner-or-collaborator (simplified to owner check for test)
    if (registration.owner !== caller) return { ok: false, value: this.ERR_UNAUTHORIZED };

    // Count versions
    let versionCount = 0;
    for (let v = 1; v <= this.MAX_VERSIONS; v++) {
      if (this.state.captureVersions.has(`${captureId}-${v}`)) versionCount++;
    }
    if (versionCount >= this.MAX_VERSIONS) return { ok: false, value: this.ERR_MAX_VERSIONS_REACHED };

    const version = versionCount + 1;
    this.state.captureVersions.set(`${captureId}-${version}`, {
      updatedHash: newHash,
      updateNotes: notes,
      timestamp: this.getBlockHeight(),
    });

    return { ok: true, value: version };
  }

  addTags(
    caller: string,
    captureId: number,
    tags: string[]
  ): ClarityResponse<boolean> {
    const registration = this.state.captureRegistry.get(captureId);
    if (!registration || registration.owner !== caller) return { ok: false, value: this.ERR_UNAUTHORIZED };

    this.state.captureTags.set(captureId, { tags });
    return { ok: true, value: true };
  }

  addCollaborator(
    caller: string,
    captureId: number,
    collaborator: string,
    role: string,
    permissions: string[]
  ): ClarityResponse<boolean> {
    const registration = this.state.captureRegistry.get(captureId);
    if (!registration || registration.owner !== caller) return { ok: false, value: this.ERR_UNAUTHORIZED };

    const collabKey = `${captureId}-${collaborator}`;
    if (this.state.collaborators.has(collabKey)) return { ok: false, value: this.ERR_ALREADY_REGISTERED };

    this.state.collaborators.set(collabKey, {
      role,
      permissions,
      addedAt: this.getBlockHeight(),
    });
    return { ok: true, value: true };
  }

  updateStatus(
    caller: string,
    captureId: number,
    newStatus: string,
    visibility: boolean
  ): ClarityResponse<boolean> {
    const registration = this.state.captureRegistry.get(captureId);
    if (!registration || registration.owner !== caller) return { ok: false, value: this.ERR_UNAUTHORIZED };

    if (!["pending", "verified", "disputed"].includes(newStatus)) {
      return { ok: false, value: this.ERR_INVALID_STATUS };
    }

    this.state.captureStatus.set(captureId, {
      status: newStatus,
      visibility,
      lastUpdated: this.getBlockHeight(),
    });
    return { ok: true, value: true };
  }

  getCaptureDetails(captureId: number): ClarityResponse<CaptureEntry | null> {
    return { ok: true, value: this.state.captureRegistry.get(captureId) ?? null };
  }

  getCaptureByHash(hash: Uint8Array): ClarityResponse<CaptureEntry | null> {
    const hashKey = this.buffToKey(hash);
    const entry = this.state.captureHashes.get(hashKey);
    if (!entry) return { ok: true, value: null };
    return this.getCaptureDetails(entry.captureId);
  }

  getVersion(captureId: number, version: number): ClarityResponse<VersionEntry | null> {
    return { ok: true, value: this.state.captureVersions.get(`${captureId}-${version}`) ?? null };
  }

  getTags(captureId: number): ClarityResponse<TagsEntry | null> {
    return { ok: true, value: this.state.captureTags.get(captureId) ?? null };
  }

  getCollaborator(captureId: number, collaborator: string): ClarityResponse<CollaboratorEntry | null> {
    return { ok: true, value: this.state.collaborators.get(`${captureId}-${collaborator}`) ?? null };
  }

  getStatus(captureId: number): ClarityResponse<StatusEntry | null> {
    return { ok: true, value: this.state.captureStatus.get(captureId) ?? null };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
};

const mockHash = new Uint8Array(32).fill(1); // Sample buff 32
const mockNewHash = new Uint8Array(32).fill(2);

describe("CaptureRegistry Contract", () => {
  let contract: CaptureRegistryMock;

  beforeEach(() => {
    contract = new CaptureRegistryMock();
  });

  it("should register a new capture event", () => {
    const result = contract.registerCapture(
      accounts.deployer,
      mockHash,
      1000,
      "DAC",
      "Site A",
      "Metadata details"
    );
    expect(result).toEqual({ ok: true, value: 1 });

    const details = contract.getCaptureDetails(1);
    expect(details.ok).toBe(true);
    expect(details.value).toMatchObject({
      owner: accounts.deployer,
      volume: 1000,
      method: "DAC",
      location: "Site A",
      metadata: "Metadata details",
    });
  });

  it("should prevent duplicate registration by hash", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const duplicate = contract.registerCapture(accounts.user1, mockHash, 2000, "CCS", "Site B", "Other");
    expect(duplicate).toEqual({ ok: false, value: 100 });
  });

  it("should add a new version to a capture", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const addVersion = contract.addVersion(accounts.deployer, 1, mockNewHash, "Updated report");
    expect(addVersion).toEqual({ ok: true, value: 1 });

    const versionDetails = contract.getVersion(1, 1);
    expect(versionDetails.ok).toBe(true);
    expect(versionDetails.value?.updateNotes).toBe("Updated report");
  });

  it("should prevent unauthorized version addition", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const addVersion = contract.addVersion(accounts.user1, 1, mockNewHash, "Unauthorized");
    expect(addVersion).toEqual({ ok: false, value: 101 });
  });

  it("should limit maximum versions", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    for (let i = 1; i <= 5; i++) {
      contract.addVersion(accounts.deployer, 1, mockNewHash, `Version ${i}`);
    }

    const exceed = contract.addVersion(accounts.deployer, 1, mockNewHash, "Too many");
    expect(exceed).toEqual({ ok: false, value: 107 });
  });

  it("should add tags to a capture", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const addTags = contract.addTags(accounts.deployer, 1, ["industrial", "renewable"]);
    expect(addTags).toEqual({ ok: true, value: true });

    const tags = contract.getTags(1);
    expect(tags.value?.tags).toEqual(["industrial", "renewable"]);
  });

  it("should add collaborator", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const addCollab = contract.addCollaborator(accounts.deployer, 1, accounts.user1, "verifier", ["update", "verify"]);
    expect(addCollab).toEqual({ ok: true, value: true });

    const collab = contract.getCollaborator(1, accounts.user1);
    expect(collab.value?.role).toBe("verifier");
  });

  it("should update status", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const update = contract.updateStatus(accounts.deployer, 1, "verified", false);
    expect(update).toEqual({ ok: true, value: true });

    const status = contract.getStatus(1);
    expect(status.value?.status).toBe("verified");
    expect(status.value?.visibility).toBe(false);
  });

  it("should prevent invalid status update", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const invalid = contract.updateStatus(accounts.deployer, 1, "invalid", true);
    expect(invalid).toEqual({ ok: false, value: 108 });
  });

  it("should get capture by hash", () => {
    contract.registerCapture(accounts.deployer, mockHash, 1000, "DAC", "Site A", "Metadata");

    const byHash = contract.getCaptureByHash(mockHash);
    expect(byHash.ok).toBe(true);
    expect(byHash.value?.volume).toBe(1000);
  });
});