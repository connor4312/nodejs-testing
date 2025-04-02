import { describe, expect, it } from "vitest";
import { parseSource } from "./parsing";
import {
  defaultTestFunctionSpecifiers,
  type TestFunctionSpecifierConfig,
} from "./test-function-specifier-config";

function parseSourceSimple(contents: string) {
  return parseSource(
    contents,
    "/workspace/",
    "/workspace/test.test.js",
    defaultTestFunctionSpecifiers,
  );
}

type ParseCustomOptions = {
  testNames?: string[];
  testImport?: string;
  workspace?: string;
  path?: string;
};

// parseSourceCustom is a ergonomic version of parseSource that has reasonable defaults for the parameters
const parseSourceCustom = (contents: string, options?: ParseCustomOptions) => {
  const testNames = options?.testNames ?? ["test"];
  const testImport = options?.testImport ?? "./test/utils";
  const workspace = options?.workspace ?? "/workspace/";
  const path = options?.path ?? "/workspace/test/addition.test.js";
  const testFunctions: TestFunctionSpecifierConfig[] = [{ import: testImport, name: testNames }];
  return parseSource(contents, workspace, path, testFunctions);
};

const testCases = (prefix = "") => `${prefix}describe("math", () => {
  ${prefix}it("addition", () => {
    strictEqual(1 + 1, 2);
  });
  ${prefix}it("addition", () => {
    strictEqual(1 + 1, 2);
  });

  ${prefix}it("subtraction", () => {
    strictEqual(1 - 1, 0);
  });
});`;

describe("extract", () => {
  it("extracts default import", () => {
    const src = `import nt from "node:test";

    ${testCases("nt.")}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts star import", () => {
    const src = `import * as nt from "node:test";

    ${testCases("nt.")}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts named imports", () => {
    const src = `import { describe, it } from "node:test";

    ${testCases()}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts aliased imports", () => {
    const src = `import { describe as xdescribe, it as xit } from "node:test";

    ${testCases("x")}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts default require", () => {
    const src = `const nt = require("node:test");

    ${testCases("nt.")}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts destructed require", () => {
    const src = `const { describe, it } = require("node:test");

    ${testCases()}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts aliased require", () => {
    const src = `const { describe: xdescribe, it: xit } = require("node:test");

    ${testCases("x")}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("extracts ts import mangled", () => {
    const src = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const node_test_1 = require("node:test");
(0, node_test_1.describe)("math", () => {
    (0, node_test_1.it)("addition", () => {
        (0, assert_1.strictEqual)(1 + 1, 2);
    });
    (0, node_test_1.it)("addition", () => {
        (0, assert_1.strictEqual)(1 + 1, 2);
    });
    (0, node_test_1.it)("subtraction", () => {
        (0, assert_1.strictEqual)(1 - 1, 0);
    });
});
//# sourceMappingURL=example.js.map`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("does not break on empty call expression (#3)", () => {
    const src = `const { describe, it } = require("node:test");

    (function() {})();

    ${testCases()}`;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("works with string literals", () => {
    const src = `
      const nt = require(\`node:test\`);

      nt.describe(\`math\`, () => {
        nt.it(\`addition\`, () => {});
      });
    `;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("works with default cjs import", () => {
    const src = `
      const nt = require(\`node:test\`);
      nt(\`addition\`, () => {});
    `;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });

  it("works with default esm import", () => {
    const src = `
      import nt from "node:test";
      nt(\`addition\`, () => {});
    `;

    expect(parseSourceSimple(src)).toMatchSnapshot();
  });
});

describe("extract with custom test specifiers in ESM code", () => {
  it("extracts default import tests", () => {
    const contents = `
import nt from "./utils";

nt("default import test", () => {
  strictEqual(1 + 1, 2);
  nt("nested test", () => {
    strictEqual(1 + 1, 2);
  });
});
`;

    const result = parseSourceCustom(contents, {
      testNames: ["default"],
    });

    // One test, and one subtest
    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts star import tests", () => {
    const contents = `import  * as Utils from "./utils";
    Utils.test("addition", () => {
      strictEqual(1 + 1, 2);

      Utils.test("subtest", () => {
        strictEqual(1 + 1, 2);
      });
    });`;

    const result = parseSourceCustom(contents, {
      testNames: ["test"],
    });

    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts named import tests", () => {
    const contents = `import { wrappedTest } from "./utils";
    wrappedTest("addition", () => {
      strictEqual(1 + 1, 2);
    });`;

    const result = parseSourceCustom(contents, {
      testNames: ["wrappedTest"],
    });
    expect(result.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts renamed named import tests", () => {
    const contents = `import { wrappedTest as renamedTest } from "./utils";
    renamedTest("addition", () => {
      strictEqual(1 + 1, 2);
    });`;

    const result = parseSourceCustom(contents, {
      testNames: ["wrappedTest"],
    });
    expect(result.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts renamed named import test", () => {
    const contents = `import { wrappedTest as renamedTest } from "./utils";
    renamedTest("addition", () => {
      strictEqual(1 + 1, 2);
    });`;

    const result = parseSourceCustom(contents, {
      testNames: ["wrappedTest"],
    });
    expect(result.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });
});

describe("extract with custom test specifiers in commonjs code", () => {
  it("extracts default require tests", () => {
    const contents = `const nt = require("./utils");

nt("default import test", () => {
  strictEqual(1 + 1, 2);
  nt("nested test", () => {
    strictEqual(1 + 1, 2);
  });
});
`;
    const result = parseSourceCustom(contents, {
      testNames: ["default"],
    });

    // One test, and one subtest
    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts destructed require", () => {
    const contents = `const { describe, it } = require("./utils");

describe("destructured test", () => {
  strictEqual(1 + 1, 2);
  it("nested test", () => {
    strictEqual(1 + 1, 2);
  });
});
`;
    const result = parseSourceCustom(contents, {
      testNames: ["describe", "it"],
    });

    // One test, and one subtest
    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts aliased require", () => {
    const contents = `const { describe: xdescribe, it: xit } = require("./utils");

xdescribe("destructured test", () => {
  strictEqual(1 + 1, 2);
  xit("nested test", () => {
    strictEqual(1 + 1, 2);
  });
});
`;

    const result = parseSourceCustom(contents, {
      testNames: ["describe", "it"],
    });

    // One test, and one subtest
    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(1);
    expect(result).toMatchSnapshot();
  });

  it("extracts ts import mangled", () => {
    const contents = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const node_test_1 = require("./utils");
(0, node_test_1.describe)("math", () => {
    (0, node_test_1.it)("addition", () => {
        (0, assert_1.strictEqual)(1 + 1, 2);
    });
    (0, node_test_1.it)("addition", () => {
        (0, assert_1.strictEqual)(1 + 1, 2);
    });
    (0, node_test_1.it)("subtraction", () => {
        (0, assert_1.strictEqual)(1 - 1, 0);
    });
});
//# sourceMappingURL=example.js.map`;

    const result = parseSourceCustom(contents, {
      testNames: ["describe", "it"],
    });

    // 1 test, 3 subtests
    expect(result.length).toEqual(1);
    expect(result[0].children.length).toEqual(3);
    expect(result).toMatchSnapshot();
  });
});
