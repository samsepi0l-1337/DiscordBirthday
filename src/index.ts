import { pathToFileURL } from "node:url";

export async function main(): Promise<void> {
  throw new Error("not implemented");
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
