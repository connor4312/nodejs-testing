import { ReportBase } from "istanbul-lib-report";
/**
 * We use an esbuild plugin to replace istanbul-reports with it. This is a
 * dependency of c8 which does dynamic requires that esbuild can't bundle.
 */
module.exports = {
  create() {
    // https://github.com/istanbuljs/istanbuljs/blob/377f8ddad6e8fdfa5752b74440aed29f299486c0/packages/istanbul-reports/lib/json/index.js
    return new (class JsonReport extends ReportBase {
      file: string;
      first: boolean;
      contentWriter: any;

      constructor() {
        super();

        this.file = "coverage-final.json";
        this.first = true;
      }

      onStart(root: any, context: any) {
        this.contentWriter = context.writer.writeFile(this.file);
        this.contentWriter.write("{");
      }

      onDetail(node: any) {
        const fc = node.getFileCoverage();
        const key = fc.path;
        const cw = this.contentWriter;

        if (this.first) {
          this.first = false;
        } else {
          cw.write(",");
        }
        cw.write(JSON.stringify(key));
        cw.write(": ");
        cw.write(JSON.stringify(fc));
        cw.println("");
      }

      onEnd() {
        const cw = this.contentWriter;
        cw.println("}");
        cw.close();
      }
    })();
  },
};
