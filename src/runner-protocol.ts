import {
  contract as makeContract,
  notificationType,
  requestType,
  semanticJson as s,
} from "@hediet/json-rpc";

const stackFrame = s.sObject({
  file: s.sUnion([s.sString(), s.sNull()]),
  lineNumber: s.sUnion([s.sNumber(), s.sNull()]),
  column: s.sUnion([s.sNumber(), s.sNull()]),
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
    logged: notificationType({
      params: s.sObject({
        id: s.optionalProp(s.sArrayOf(s.sString())),
        line: s.sObject({
          chunk: s.sString(),
          sh: stackFrame,
        }),
      }),
    }),
    finished: notificationType({
      params: s.sObject({
        id: s.sArrayOf(s.sString()),
        status: s.sNumber(),
        duration: s.optionalProp(s.sNumber()),
        expected: s.optionalProp(s.sString()),
        actual: s.optionalProp(s.sString()),
        error: s.optionalProp(s.sString()),
        stack: s.optionalProp(s.sArrayOf(stackFrame)),
      }),
    }),
  },
  // the interface for servers to interact with clients
  client: {
    start: requestType({
      params: s.sObject({
        concurrency: s.sNumber(),
        files: s.sArrayOf(
          s.sObject({
            uri: s.sString(),
            path: s.sString(),
            include: s.optionalProp(s.sArrayOf(s.sString())),
            exclude: s.optionalProp(s.sArrayOf(s.sString())),
          })
        ),
      }),
      result: s.sObject({
        status: s.sNumber(),
        message: s.optionalProp(s.sString()),
      }),
    }),
  },
});

export type IClient = typeof contract["TClientInterface"];

export type ITestRunFile = typeof contract["client"]["start"]["paramsSerializer"]["T"]["files"][0];

export type ITestRunResult = typeof contract["client"]["start"]["resultSerializer"]["T"];

export const enum CompleteStatus {
  Done,
  NodeVersionOutdated,
}

export const enum Result {
  Ok,
  Skipped,
  Failed,
}
