import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const webRoot = process.cwd();
const repositoryRoot = path.resolve(webRoot, "..");
const roots = [
  path.join(webRoot, "app"),
  path.join(repositoryRoot, "launcher"),
];

const forbiddenPhrases = [
  "旧方案",
  "旧版",
  "无需 Token",
  "无需token",
  "通达信客户端",
  "后台 worker",
  "worker 会",
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath));
    else if (/\.(tsx|ts|cs)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function visibleLine(line) {
  const withoutComment = line.replace(/\/\/.*$/, "");
  return /[\u3400-\u9fff]/.test(withoutComment) ? withoutComment : "";
}

const files = (await Promise.all(roots.map(collectFiles))).flat();
const findings = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  source.split(/\r?\n/).forEach((line, index) => {
    const candidate = visibleLine(line);
    for (const phrase of forbiddenPhrases) {
      if (candidate.includes(phrase)) {
        findings.push(`${path.relative(repositoryRoot, file)}:${index + 1}: ${phrase}`);
      }
    }
  });
}

if (findings.length > 0) {
  console.error("发现客户可见文案中的内部表达：");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log("客户文案检查通过。");
}
