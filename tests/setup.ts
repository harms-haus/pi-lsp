import { vi } from "vitest";

// Mock child_process for all tests - but allow selective unmocking in specific tests
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));
