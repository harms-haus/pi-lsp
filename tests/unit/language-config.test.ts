import { describe, it, expect, vi, beforeEach } from "vitest";
import { languageFromPath, isServerInstalled } from "../../src/language-config.js";
import { TEST_TS_CONFIG, TEST_PY_CONFIG } from "../helpers/fixtures.js";

// Mock child_process
const { execFile } = await import("node:child_process");

describe("languageFromPath", () => {
  it("should detect TypeScript from .ts extension", () => {
    const config = languageFromPath("/project/src/index.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect TypeScript from .tsx extension", () => {
    const config = languageFromPath("/project/src/App.tsx");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect TypeScript from .js extension", () => {
    const config = languageFromPath("/project/src/index.js");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should detect Python from .py extension", () => {
    const config = languageFromPath("/project/main.py");
    expect(config).toBeDefined();
    expect(config!.language).toBe("python");
  });

  it("should detect Rust from .rs extension", () => {
    const config = languageFromPath("/project/src/main.rs");
    expect(config).toBeDefined();
    expect(config!.language).toBe("rust");
  });

  it("should detect Go from .go extension", () => {
    const config = languageFromPath("/project/main.go");
    expect(config).toBeDefined();
    expect(config!.language).toBe("go");
  });

  it("should detect C/C++ from .c extension", () => {
    const config = languageFromPath("/project/main.c");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect C/C++ from .cpp extension", () => {
    const config = languageFromPath("/project/main.cpp");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect C/C++ from .h extension", () => {
    const config = languageFromPath("/project/header.h");
    expect(config).toBeDefined();
    expect(config!.language).toBe("cpp");
  });

  it("should detect Java from .java extension", () => {
    const config = languageFromPath("/project/Main.java");
    expect(config).toBeDefined();
    expect(config!.language).toBe("java");
  });

  it("should detect Ruby from .rb extension", () => {
    const config = languageFromPath("/project/script.rb");
    expect(config).toBeDefined();
    expect(config!.language).toBe("ruby");
  });

  it("should detect Lua from .lua extension", () => {
    const config = languageFromPath("/project/script.lua");
    expect(config).toBeDefined();
    expect(config!.language).toBe("lua");
  });

  it("should detect HTML from .html extension", () => {
    const config = languageFromPath("/project/index.html");
    expect(config).toBeDefined();
    expect(config!.language).toBe("html");
  });

  it("should detect CSS from .css extension", () => {
    const config = languageFromPath("/project/styles.css");
    expect(config).toBeDefined();
    expect(config!.language).toBe("css");
  });

  it("should detect JSON from .json extension", () => {
    const config = languageFromPath("/project/config.json");
    expect(config).toBeDefined();
    expect(config!.language).toBe("json");
  });

  it("should detect YAML from .yaml extension", () => {
    const config = languageFromPath("/project/config.yaml");
    expect(config).toBeDefined();
    expect(config!.language).toBe("yaml");
  });

  it("should detect YAML from .yml extension", () => {
    const config = languageFromPath("/project/config.yml");
    expect(config).toBeDefined();
    expect(config!.language).toBe("yaml");
  });

  it("should detect Markdown from .md extension", () => {
    const config = languageFromPath("/project/README.md");
    expect(config).toBeDefined();
    expect(config!.language).toBe("markdown");
  });

  it("should return undefined for unknown extensions", () => {
    expect(languageFromPath("/project/data.csv")).toBeUndefined();
    expect(languageFromPath("/project/image.png")).toBeUndefined();
    expect(languageFromPath("/project/data.txt")).toBeUndefined();
  });

  it("should return undefined for files without extension", () => {
    expect(languageFromPath("/project/Makefile")).toBeUndefined();
    expect(languageFromPath("/project/.gitignore")).toBeUndefined();
  });

  it("should handle paths with multiple dots", () => {
    const config = languageFromPath("/project/file.test.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });

  it("should handle Windows-style paths", () => {
    const config = languageFromPath("C:\\project\\index.ts");
    expect(config).toBeDefined();
    expect(config!.language).toBe("typescript");
  });
});

describe("isServerInstalled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return true when detect command succeeds", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    const installed = await isServerInstalled(TEST_TS_CONFIG);
    expect(installed).toBe(true);
  });

  it("should return false when detect command fails", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(new Error("Command not found"), "", "");
      return { kill: vi.fn() } as any;
    });

    const installed = await isServerInstalled(TEST_TS_CONFIG);
    expect(installed).toBe(false);
  });

  it("should return false when detect command throws", async () => {
    vi.mocked(execFile).mockImplementation(() => {
      throw new Error("execFile failed");
    });

    const installed = await isServerInstalled(TEST_PY_CONFIG);
    expect(installed).toBe(false);
  });

  it("should call correct detect command", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, options, callback) => {
      const cb = (typeof options === 'function' ? options : callback) as (error: Error | null, stdout: string, stderr: string) => void;
      cb(null, "typescript-language-server 4.0.0\n", "");
      return { kill: vi.fn() } as any;
    });

    await isServerInstalled(TEST_TS_CONFIG);
    const parts = TEST_TS_CONFIG.detectCommand.split(/\s+/);
    expect(execFile).toHaveBeenCalledWith(
      parts[0],
      parts.slice(1),
      expect.objectContaining({ timeout: 10000 }),
      expect.any(Function),
    );
  });

  it("should handle timeout gracefully", async () => {
    vi.mocked(execFile).mockImplementation((_cmd, _args, options, callback) => {
      // Simulate timeout by calling back with a timed-out error
      const cb = (typeof options === 'function' ? options : callback) as (error: Error & { killed?: boolean }, stdout: string, stderr: string) => void;
      const err = new Error("Command timed out") as Error & { killed?: boolean };
      err.killed = true;
      cb(err, "", "");
      return { kill: vi.fn() } as any;
    });

    const installed = await isServerInstalled(TEST_TS_CONFIG);
    expect(installed).toBe(false);
  });
});
