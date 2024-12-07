import { contract as makeContract, requestType, semanticJson as s } from "@hediet/json-rpc";

export const contract = makeContract({
  name: "NodeJSTSServer",
  server: {},
  client: {
    parse: requestType({
      params: s.sObject({
        path: s.sString(),
        onlyIfInProgram: s.sBoolean(),
      }),
      result: s.sAny(), // IParsedNode | undefined
    }),
  },
});
