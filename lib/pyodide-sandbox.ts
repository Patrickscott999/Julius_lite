import { loadPyodide, type PyodideInterface } from "pyodide";
import type { DatasetRec } from "./agent-run";
import fsSync from "node:fs";

let pyodide: Promise<PyodideInterface> | null = null;

/** Pyodide singleton (in-process WASM sandbox), pandas + numpy preinstalled. */
export function getPyodide(): Promise<PyodideInterface> {
  pyodide ??= (async () => {
    const py = await loadPyodide();
    // pandas' import lives in the preamble we generate, not in user code,
    // so loadPackagesFromImports never sees it — install explicitly.
    await py.loadPackage("pandas");
    return py;
  })();
  return pyodide;
}

export interface RunResult {
  stdout: string;
  error?: string;
}

/**
 * Define each uploaded dataset as a pandas DataFrame, then execute user code.
 * `df` is the first dataset; every dataset also gets its own df_* variable.
 * Output = captured stdout + the repr of the last expression (Python REPL style).
 */
export async function runPython(code: string, datasets: DatasetRec[]): Promise<RunResult> {
  const py = await getPyodide();
  let preamble = "import pandas as pd\n";
  for (const ds of datasets) {
    py.FS.writeFile(ds.name, new Uint8Array(fsSync.readFileSync(ds.path)));
    preamble += `${ds.varName} = pd.read_csv("${ds.name}")\n`;
  }
  if (datasets.length > 0) preamble += `df = ${datasets[0].varName}\n`;

  let out = "";
  try {
    await py.loadPackagesFromImports(preamble + code);
    py.setStdout({ batched: (s) => (out += s + "\n") });
    py.setStderr({ batched: (s) => (out += s + "\n") });
    const result = await py.runPythonAsync(preamble + code);
    const text = result === undefined || result === null ? out : (out ? out + "\n" : "") + String(result);
    try {
      py.setStdout();
      py.setStderr();
    } catch {
      // restore failures are harmless in-process
    }
    return { stdout: text.trim().slice(0, 20000) };
  } catch (err) {
    try {
      py.setStdout();
      py.setStderr();
    } catch {
      // ignore
    }
    const msg = typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : String(err);
    // Include whatever printed before the failure — the model can debug from it.
    return { stdout: out.trim().slice(0, 4000), error: msg.split("\n").slice(-12).join("\n") };
  }
}