import fs from "node:fs";
import solc from "solc";
const input = {
  language: "Solidity",
  sources: Object.fromEntries(
    ["Murmur.sol", "MurmurLedger.sol"].map((f) => [
      f,
      { content: fs.readFileSync("src/" + f, "utf8") },
    ]),
  ),
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import: (p) => {
      try {
        return { contents: fs.readFileSync("node_modules/" + p, "utf8") };
      } catch {
        return { error: "missing " + p };
      }
    },
  }),
);
for (const e of output.errors || []) console.log(e.formattedMessage);
if ((output.errors || []).some((e) => e.severity === "error")) process.exit(1);
fs.mkdirSync("artifacts", { recursive: true });
const compiled = Object.assign({}, ...Object.values(output.contracts));
for (const [name, value] of Object.entries(compiled))
  fs.writeFileSync(
    "artifacts/" + name + ".json",
    JSON.stringify(
      { abi: value.abi, bytecode: "0x" + value.evm.bytecode.object },
      null,
      2,
    ),
  );
console.log("compiled", Object.keys(compiled).join(", "));
