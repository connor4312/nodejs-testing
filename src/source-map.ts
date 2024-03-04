import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { dataUriToBuffer } from "data-uri-to-buffer";
import * as fs from "fs/promises";
import { fileURLToPath } from "url";
import * as vscode from "vscode";

const smUrlComment = "//# sourceMappingURL=";

export interface IMappingAccessor {
  /**
   * @param line base-1 line
   * @param col base-0 column
   */
  originalPositionFor(line: number, col: number): vscode.Location;
}

export const identityMapping = (file: vscode.Uri): IMappingAccessor => ({
  originalPositionFor(line, col) {
    // VS Code positions are base 0, adjust the line
    return new vscode.Location(file, new vscode.Position(line - 1, col));
  },
});

const smMappingAccessor = (file: vscode.Uri, sm: TraceMap): IMappingAccessor => ({
  originalPositionFor(line, column) {
    const { source, line: smLine, column: smCol } = originalPositionFor(sm, { line, column });
    if (!source) {
      // VS Code positions are base 0, adjust the line
      return new vscode.Location(file, new vscode.Position(line - 1, column));
    }

    return new vscode.Location(vscode.Uri.parse(source), new vscode.Position(smLine - 1, smCol));
  },
});

export const parseSourceMap = (
  path: vscode.Uri,
  contents: string,
): IMappingAccessor | Promise<IMappingAccessor> => {
  const start = contents.lastIndexOf(smUrlComment);
  if (start === -1) {
    return identityMapping(path);
  }

  let end = contents.indexOf("\n", start + smUrlComment.length);
  if (end === -1) {
    end = contents.length;
  }

  const sourceMapUrl = contents.slice(start + smUrlComment.length, end).trim();
  return parseSourceMapURL(path, sourceMapUrl);
};

export const parseSourceMapURL = (path: vscode.Uri, sourceMapUrl: string) => {
  const pathAsStr = path.toString();
  if (sourceMapUrl.startsWith("data:")) {
    const data = dataUriToBuffer(sourceMapUrl);
    const jsonStr = new TextDecoder().decode(data.buffer);
    return smMappingAccessor(path, new TraceMap(jsonStr, pathAsStr));
  }

  const sourceMapPath = fileURLToPath(new URL(sourceMapUrl, pathAsStr).toString());
  try {
    return fs
      .readFile(sourceMapPath, "utf8")
      .then((c) => smMappingAccessor(path, new TraceMap(c, pathAsStr)))
      .catch(() => identityMapping(path));
  } catch {
    return identityMapping(path);
  }
};
