import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import { createServer, Server } from "net";
import { tmpdir } from "os";
import { join } from "path";
import * as vscode from "vscode";
import { ConfigValue } from "../configValue";
import { parseSource as parseAcornSource } from "./acorn-parsing";
import { contract } from "./server-protocol";
import { IParsedNode } from "./ts-parsing";

let socketCounter = 0;
const socketDir = process.platform === "win32" ? "\\\\.\\pipe\\" : tmpdir();
const typeScriptExtensionId = "vscode.typescript-language-features";

export const getRandomPipe = () =>
  join(socketDir, `nodejs-test.${process.pid}-${socketCounter++}.sock`);

export class SourceParserServer implements vscode.Disposable {
  public readonly address = getRandomPipe();
  private readonly onDidConnect = new vscode.EventEmitter<void>();
  private readonly connected = new Set<(typeof contract)["TClientInterface"]>();
  private readonly netServer: Server;
  private readonly useTsServer = new ConfigValue("useTypeScriptServer", true);
  private installed?: Promise<void>;

  constructor() {
    this.netServer = createServer((socket) => {
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

    if (this.useTsServer.value) {
      this.netServer.listen(this.address);
    }
  }

  private showInstallError() {
    vscode.window.showErrorMessage(
      "The Node.js test runner extension requires the TypeScript Language Features extension (${typeScriptExtensionId}) but it is not installed or is disabled.",
    );
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

    api.configurePlugin("@c4312/nodejs-testing-ts-server-plugin", {
      address: this.address,
    });
  }

  public dispose() {
    this.netServer.close();
    this.onDidConnect.dispose();
  }

  public async parse(file: string): Promise<IParsedNode[] | undefined> {
    if (!this.useTsServer.value) {
      return parseAcornSource(vscode.Uri.file(file).fsPath);
    }
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
