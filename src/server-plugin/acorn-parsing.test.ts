import { describe, expect, it } from "vitest";
import { parseSource } from "./acorn-parsing";

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

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts star import", () => {
    const src = `import * as nt from "node:test";

    ${testCases("nt.")}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts named imports", () => {
    const src = `import { describe, it } from "node:test";

    ${testCases()}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts aliased imports", () => {
    const src = `import { describe as xdescribe, it as xit } from "node:test";

    ${testCases("x")}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts default require", () => {
    const src = `const nt = require("node:test");

    ${testCases("nt.")}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts destructed require", () => {
    const src = `const { describe, it } = require("node:test");

    ${testCases()}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("extracts aliased require", () => {
    const src = `const { describe: xdescribe, it: xit } = require("node:test");

    ${testCases("x")}`;

    expect(parseSource(src)).toMatchSnapshot();
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

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("does not break on empty call expression (#3)", () => {
    const src = `const { describe, it } = require("node:test");

    (function() {})();

    ${testCases()}`;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("works with string literals", () => {
    const src = `
      const nt = require(\`node:test\`);

      nt.describe(\`math\`, () => {
        nt.it(\`addition\`, () => {});
      });
    `;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("works with default cjs import", () => {
    const src = `
      const nt = require(\`node:test\`);
      nt(\`addition\`, () => {});
    `;

    expect(parseSource(src)).toMatchSnapshot();
  });

  it("works with default esm import", () => {
    const src = `
      import nt from "node:test";
      nt(\`addition\`, () => {});
    `;

    expect(parseSource(src)).toMatchSnapshot();
  });
});
