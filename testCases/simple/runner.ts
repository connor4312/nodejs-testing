import { expectTestTree, getController } from "../../src/test/util";

it("discovers tests", async () => {
  const c = await getController();
  await c.startWatchingWorkspace();

  await expectTestTree(c, [
    ["hello.test.js", [["math", [["addition"], ["subtraction"]]]]],
    ["test", [["inAFolder.js", [["addition"]]]]],
    ["test-WithADash.js", [["addition"]]],
    ["test.js", [["addition"]]],
    ["withADashTheOtherWay-test.js", [["addition"]]],
    ["withADot.test.js", [["addition"]]],
  ]);
});
