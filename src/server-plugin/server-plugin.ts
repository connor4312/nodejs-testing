import { Contract } from "@hediet/json-rpc";
import { NodeJsMessageStream } from "@hediet/json-rpc-streams/src";
import EventEmitter from "events";
import { readFile } from "fs/promises";
import { connect } from "net";
import type ts from "typescript";
import type * as ts_module from "typescript/lib/tsserverlibrary";
import { contract } from "./server-protocol";
import { parseSource } from "./ts-parsing";

const pluginId = "@c4312/nodejs-testing-ts-server-plugin";

interface IConfig {
  address: string;
}

function init({ typescript }: { typescript: typeof ts_module }) {
  class Logger {
    public static forPlugin(info: ts_module.server.PluginCreateInfo) {
      return new Logger(info.project.projectService.logger);
    }

    private constructor(private readonly value: ts_module.server.Logger) {}

    public info(...parts: any[]) {
      if (this.value.hasLevel(typescript.server.LogLevel.normal)) {
        this.log(parts);
      }
    }

    public verbose(...parts: any[]) {
      if (this.value.hasLevel(typescript.server.LogLevel.verbose)) {
        this.log(parts);
      }
    }

    private log(parts: any[]) {
      this.value.info(
        `[${pluginId}] ${parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}`,
      );
    }
  }

  const ee = new EventEmitter();
  let logger: Logger | undefined;

  function connectServer(info: ts.server.PluginCreateInfo, config: IConfig) {
    logger?.info(`Connecting to server at ${config.address}...`);

    function parseFromProgram(path: string) {
      logger?.verbose(`Parsing from program`, path);
      const normPath = typescript.server.toNormalizedPath(path);
      if (!info.project.containsFile(normPath)) {
        logger?.verbose(`Skipping because we don't contain noramlized path`, normPath);
        return false;
      }

      const scriptInfo = info.project.getScriptInfoForNormalizedPath(normPath);
      const script = scriptInfo && info.project.getSourceFile(scriptInfo.path);
      if (!script) {
        logger?.info(`ScriptInfo not found for ${normPath} which should have been in project`);
      }

      const ret = script && parseSource(typescript, script);
      logger?.verbose("Parsed", normPath, ret?.length);
      return ret;
    }

    async function parseFromDisk(path: string) {
      return parseSource(
        typescript,
        typescript.createSourceFile(
          "file.ts",
          await readFile(path, "utf8"),
          typescript.ScriptTarget.Latest,
          true,
        ),
      );
    }

    function removeListeners() {
      ee.removeListener("configChange", reconnect);
      socket.removeListener("error", reconnect);
      socket.removeListener("close", reconnect);
    }

    function reconnect(err: unknown) {
      logger?.info("Reconnecting to server, after err:", err);
      removeListeners();
      setTimeout(() => connectServer(info, config), 1000);
    }

    function configChange(newConfig: IConfig) {
      removeListeners();
      socket.end();
      connectServer(info, newConfig);
    }

    const socket = connect(config.address);
    socket.on("error", reconnect);
    socket.on("close", reconnect);
    ee.once("configChange", configChange);

    const stream = new NodeJsMessageStream(socket, socket);
    Contract.getServerFromStream(
      contract,
      stream,
      {},
      {
        parse({ path, onlyIfInProgram }) {
          const fromDisk = parseFromProgram(path);
          return fromDisk || onlyIfInProgram ? Promise.resolve(fromDisk) : parseFromDisk(path);
        },
      },
    );
  }

  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      logger = Logger.forPlugin(info);

      if (!info.config?.address) {
        logger.info("Waiting for server address...");
        ee.once("configChange", (config: IConfig) => connectServer(info, config));
      } else {
        connectServer(info, info.config);
      }

      return info.languageService;
    },
    onConfigurationChanged(config: IConfig) {
      ee.emit("configChange", config);
    },
  };
}

export = init;
