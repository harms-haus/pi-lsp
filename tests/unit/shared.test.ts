import { describe, it, expect } from "vitest";
import {
  applyEdits,
  buildDiff,
  resolveFile,
  uriToFilePath,
  filePathToUri,
} from "../../src/tools/shared.js";

describe("applyEdits", () => {
  it("should insert text at the start of a file", () => {
    const text = "line2\nline3";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "line1\n",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nline2\nline3");
  });

  it("should insert text in the middle of a line", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      newText: "beautiful ",
    }];
    expect(applyEdits(text, edits)).toBe("hellobeautiful  world");
  });

  it("should replace text within a line", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      newText: "goodbye",
    }];
    expect(applyEdits(text, edits)).toBe("goodbye world");
  });

  it("should delete text (empty newText)", () => {
    const text = "hello world";
    const edits = [{
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
      newText: "",
    }];
    expect(applyEdits(text, edits)).toBe("hello ");
  });

  it("should handle multi-line replacement", () => {
    const text = "line1\nline2\nline3\nline4";
    const edits = [{
      range: { start: { line: 1, character: 0 }, end: { line: 2, character: 5 } },
      newText: "REPLACEMENT",
    }];
    expect(applyEdits(text, edits)).toBe("line1\nREPLACEMENT\nline4");
  });

  it("should handle multiple edits (applied in reverse order)", () => {
    const text = "aaaa\nbbbb\ncccc";
    const edits = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: "1111" },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: "2222" },
      { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } }, newText: "3333" },
    ];
    expect(applyEdits(text, edits)).toBe("1111\n2222\n3333");
  });

  it("should handle empty edits array", () => {
    expect(applyEdits("hello world", [])).toBe("hello world");
  });

  it("should handle edit at the end of file", () => {
    const text = "hello";
    const edits = [{
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 5 } },
      newText: " world",
    }];
    expect(applyEdits(text, edits)).toBe("hello world");
  });
});

describe("buildDiff", () => {
  it("should show 'no changes' for identical files", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("(no changes)");
  });

  it("should show single line change with correct hunk header", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nmodified\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("--- a/test.ts");
    expect(diff).toContain("+++ b/test.ts");
    expect(diff).toContain("-line2");
    expect(diff).toContain("+modified");
  });

  it("should show added lines with + prefix", () => {
    const original = "line1\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line2");
  });

  it("should show removed lines with - prefix", () => {
    const original = "line1\nline2\nline3";
    const modified = "line1\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("-line2");
  });

  it("should handle multiple changes", () => {
    const original = "line1\nline2\nline3\nline4";
    const modified = "line1\nmodified1\nline3\nmodified2";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("-line2");
    expect(diff).toContain("+modified1");
    expect(diff).toContain("-line4");
    expect(diff).toContain("+modified2");
  });

  it("should handle adding at the beginning", () => {
    const original = "line2\nline3";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line1");
  });

  it("should handle adding at the end", () => {
    const original = "line1\nline2";
    const modified = "line1\nline2\nline3";
    const diff = buildDiff("test.ts", original, modified);
    expect(diff).toContain("+line3");
  });
});

describe("resolveFile", () => {
  it("should return absolute paths unchanged", () => {
    expect(resolveFile("/home/user/file.ts", "/home/other"))
      .toBe("/home/user/file.ts");
  });

  it("should resolve relative paths against cwd", () => {
    expect(resolveFile("src/file.ts", "/home/user"))
      .toBe("/home/user/src/file.ts");
  });

  it("should handle paths with ..", () => {
    expect(resolveFile("../file.ts", "/home/user/project"))
      .toBe("/home/user/file.ts");
  });

  it("should handle paths with .", () => {
    expect(resolveFile("./file.ts", "/home/user"))
      .toBe("/home/user/file.ts");
  });

  it("should handle complex relative paths", () => {
    // path.resolve in Node.js doesn't normalize .. in the same way as bash
    // It keeps the path as-is and resolves against cwd
    const result = resolveFile("src/../other/file.ts", "/home/user/project");
    expect(result).toContain("other/file.ts");
  });
});

describe("uriToFilePath", () => {
  it("should convert file:// URI to local path", () => {
    expect(uriToFilePath("file:///home/user/file.ts"))
      .toBe("/home/user/file.ts");
  });

  it("should decode URI-encoded characters", () => {
    expect(uriToFilePath("file:///home/my%20docs/file.ts"))
      .toBe("/home/my docs/file.ts");
  });

  it("should handle encoded slash", () => {
    expect(uriToFilePath("file:///home/user/file%2Fname.ts"))
      .toBe("/home/user/file/name.ts");
  });

  it("should handle empty URI", () => {
    expect(uriToFilePath("file://")).toBe("");
  });

  it("should handle URI with query string (not typical for files)", () => {
    expect(uriToFilePath("file:///home/user/file.ts?query=1"))
      .toBe("/home/user/file.ts?query=1");
  });
});

describe("filePathToUri", () => {
  it("should convert local path to file:// URI", () => {
    expect(filePathToUri("/home/user/file.ts"))
      .toBe("file:///home/user/file.ts");
  });

  it("should encode special characters in URI", () => {
    expect(filePathToUri("/home/my docs/file.ts"))
      .toBe("file:///home/my%20docs/file.ts");
  });

  it("should encode spaces correctly", () => {
    expect(filePathToUri("/path/with spaces/file.ts"))
      .toContain("%20");
  });
});
