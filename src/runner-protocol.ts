import {
  contract as makeContract,
  notificationType,
  requestType,
  semanticJson as s,
} from "@hediet/json-rpc";
import { TestEvent } from "node:test/reporters";
import { StackFrame } from "stacktrace-parser";

const stackFrame = s.sObject({
  file: s.sUnion([s.sString(), s.sNull()]),
  lineNumber: s.sUnion([s.sNumber(), s.sNull()]),
  column: s.sUnion([s.sNumber(), s.sNull()]),
});

const log = s.sObject({
  chunk: s.sString(),
  sf: s.optionalProp(stackFrame),
});

export const contract = makeContract({
  name: "NodeJSTestRunner",
  // the interface for clients to interact with servers
  server: {
    started: notificationType({
      params: s.sObject({
        id: s.sArrayOf(s.sString()),
      }),
    }),
    skipped: notificationType({
      params: s.sObject({
        id: s.sArrayOf(s.sString()),
      }),
    }),
    passed: notificationType({
      params: s.sObject({
        id: s.sArrayOf(s.sString()),
        duration: s.optionalProp(s.sNumber()),
      }),
    }),
    failed: notificationType({
      params: s.sObject({
        id: s.sArrayOf(s.sString()),
        duration: s.optionalProp(s.sNumber()),
        expected: s.optionalProp(s.sString()),
        actual: s.optionalProp(s.sString()),
        error: s.optionalProp(s.sString()),
        stack: s.optionalProp(s.sArrayOf(stackFrame)),
      }),
    }),
    output: notificationType({
      params: s.sString(),
    }),
    sourceMap: notificationType({
      params: s.sObject({
        testFile: s.sString(),
        sourceMapURL: s.sString(),
      }),
    }),
    log: notificationType({
      params: s.sObject({
        id: s.optionalProp(s.sArrayOf(s.sString())),
        prefix: s.sString(),
        log,
      }),
    }),
  },
  // the interface for servers to interact with clients
  client: {
    kill: notificationType({}),
    start: requestType({
      params: s.sObject({
        verbose: s.sBoolean(),
        concurrency: s.sNumber(),
        files: s.sArrayOf(
          s.sObject({
            // VS Code URI of the file to associate the test with. For sourcemaps,
            // may not be the same as the location pointed to by the `path`
            uri: s.sString(),
            // fs path of the file to run
            path: s.sString(),
            // Test names to includes via --test-name-pattern.
            include: s.optionalProp(s.sArrayOf(s.sString())),
          }),
        ),
        extensions: s.sArrayOf(
          s.sObject({
            // VS Code URI of the file to associate the test with. For sourcemaps,
            // may not be the same as the location pointed to by the `path`
            extensions: s.sArrayOf(s.sString()),
            // fs path of the file to run
            parameters: s.sArrayOf(s.sString()),
          }),
        ),
      }),
      result: s.sObject({
        status: s.sNumber(),
        message: s.optionalProp(s.sString()),
      }),
    }),
  },
});

export type IClient = (typeof contract)["TClientInterface"];

export type ITestRunFile =
  (typeof contract)["client"]["start"]["paramsSerializer"]["T"]["files"][0];

export type ITestRunResult = (typeof contract)["client"]["start"]["resultSerializer"]["T"];

export type ILog = (typeof log)["T"];

export const enum CompleteStatus {
  Done,
  NodeVersionOutdated,
}

export const enum Result {
  Ok,
  Skipped,
  Failed,
}

export type JsonFromReporter = TestEvent | { type: "runner:log"; chunk: string; sf?: StackFrame };
