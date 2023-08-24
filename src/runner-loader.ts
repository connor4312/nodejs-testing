import { parse } from "stacktrace-parser";

const stackObj = { stack: "" };

// Kinda delicate thing to separate test tap output from output logged by tests.
// Node.js doesn't know about output that happens when running tests, so we put
// them in tap comments and include their location.
for (const channel of ["stderr", "stdout"] as const) {
  const ogWrite = process[channel].write;
  Object.assign(process[channel], {
    write(chunk: any, encoding: any, callback: any) {
      Error.captureStackTrace(stackObj);
      const stack = parse(stackObj.stack);

      const firstNotInternal = stack.findIndex(
        (s, i) => i > 0 && s.file?.startsWith("node:") === false,
      );
      const atTestRunner = stack.findIndex((s) => s.file?.includes("node:internal/test_runner"));

      // Treat this as a user log if there's an not `node:` internal log before
      // the first (if any) location from `node:internal/test_runner`
      if (firstNotInternal !== -1 && (atTestRunner === -1 || firstNotInternal < atTestRunner)) {
        chunk = `# Log: ${JSON.stringify({
          chunk: chunk.toString(),
          sf: stack[firstNotInternal],
        })}\n`;
      }

      return ogWrite.call(this, chunk, encoding, callback);
    },
  });
}
