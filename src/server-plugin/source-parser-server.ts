import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import { createServer } from "net";
import { tmpdir } from "os";
import { extname, join } from "path";
import * as vscode from "vscode";
import { ConfigValue } from "../configValue";
import { MutableDisposable } from "../disposable";
import { parseSource as parseAcornSource } from "./acorn-parsing";
import { contract } from "./server-protocol";
import { IParsedNode } from "./ts-parsing";

let socketCounter = 0;
const socketDir = process.platform === "win32" ? "\\\\.\\pipe\\" : tmpdir();
const typeScriptExtensionId = "vscode.typescript-language-features";

export const getRandomPipe = () =>
  join(socketDir, `nodejs-test.${process.pid}-${socketCounter++}.sock`);

const jsTsExtensions = new Set([".js", ".ts", ".mjs", ".mts", ".cjs", ".cts"]);

export class SourceParserServer implements vscode.Disposable {
  public readonly address = getRandomPipe();
  private readonly onDidConnect = new vscode.EventEmitter<void>();
  private readonly connected = new Set<(typeof contract)["TClientInterface"]>();
  private readonly useTsServer = new ConfigValue("useTypescriptServer", true);
  private readonly netServer = new MutableDisposable();
  private hasOpenedJsTsDocument = false;
  private installed?: Promise<void>;

  private showInstallError() {
    vscode.window.showErrorMessage(
      "The Node.js test runner extension requires the TypeScript Language Features extension (${typeScriptExtensionId}) but it is not installed or is disabled.",
    );
  }

  private startServer() {
    const server = createServer((socket) => {
      const s = Contract.registerServerToStream(
        contract,
        new NodeJsMessageStream(socket, socket),
        {},
        {},
      );
      this.connected.add(s.client);
      socket.on("close", () => this.connected.delete(s.client));
      socket.on("error", () => this.connected.delete(s.client));
      this.onDidConnect.fire();
    });

    server.on("error", () => {
      vscode.window.showErrorMessage(
        "Error starting the Node.js test runner server, please file an issue.",
      );
    });

    this.netServer.value = {
      dispose: () => server.close(),
    };

    return new Promise<void>((r) => server.listen(this.address, r));
  }

  private async install() {
    const extension = vscode.extensions.getExtension(typeScriptExtensionId);
    if (!extension) {
      return this.showInstallError();
    }

    await extension.activate();
    if (!extension.exports || !extension.exports.getAPI) {
      return this.showInstallError();
    }
    const api = extension.exports.getAPI(0);
    if (!api) {
      return;
    }

    await this.startServer();

    api.configurePlugin("@c4312/nodejs-testing-ts-server-plugin", {
      address: this.address,
    });
  }

  private async triggerTsActivation(file: string) {
    // This is needed because the TS host is activated lazily, and until
    // a document is opened all calls to the TS server will block. See:
    // https://github.com/microsoft/vscode/blob/49e0129f38291beeedfc5777c6c18c288ddf878e/extensions/typescript-language-features/src/lazyClientHost.ts#L84-L91
    // Without this, then tests cannot be discovered until a user opens a file.
    if (this.hasOpenedJsTsDocument || !jsTsExtensions.has(extname(file))) {
      return;
    }

    this.hasOpenedJsTsDocument = true;

    const doc = await vscode.workspace.openTextDocument(file);

    // It seems that just opening a document is not enough to wake the language
    // server, so we also ask for definitions at the first character.
    await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      doc.uri,
      new vscode.Position(0, 0),
    );
  }

  public dispose() {
    this.netServer.dispose();
    this.onDidConnect.dispose();
  }

  public async parse(file: string, contents: string): Promise<IParsedNode[] | undefined> {
    if (!this.useTsServer.value) {
      return parseAcornSource(contents);
    }

    await this.triggerTsActivation(file);
    this.installed ??= this.install();
    await this.installed;

    if (!this.connected.size) {
      await new Promise<void>((resolve) => {
        const disposable = this.onDidConnect.event(() => {
          disposable.dispose();
          resolve();
        });
      });
    }

    const inProgram = await Promise.all(
      [...this.connected].map((s) => s.parse({ path: file, onlyIfInProgram: true })),
    );

    const foundInProgram = inProgram.find((x) => x !== undefined);
    if (foundInProgram) {
      return foundInProgram;
    }

    for (const s of this.connected) {
      const result = await s.parse({ path: file, onlyIfInProgram: false });
      if (result) {
        return result;
      }
    }

    return undefined;
  }
}
