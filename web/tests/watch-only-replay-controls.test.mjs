import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("replay controls appear in training and stay absent in all live markets", async () => {
  const source = await readFile(new URL("../app/components/TrainingWorkbench.tsx", import.meta.url), "utf8");
  const file = ts.createSourceFile("TrainingWorkbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let guard;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => (
      ts.isJsxAttribute(attribute) && attribute.name.getText(file) === "className"
      && attribute.initializer?.text === "replay-controls"
    ))) {
      assert.ok(ts.isBinaryExpression(node.parent), "the whole toolbar must be conditional");
      assert.equal(node.parent.operatorToken.kind, ts.SyntaxKind.AmpersandAmpersandToken);
      guard = node.parent.left.getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(guard, "replay toolbar must exist for training");
  const visible = new Function("liveMode", `return Boolean(${guard});`);
  assert.equal(visible(false), true, "training keeps playback controls");
  assert.equal(visible(true), false, "A-share and US observation hides playback controls");
  assert.doesNotMatch(source, /latestWatchMode|仅看盘/);
});
