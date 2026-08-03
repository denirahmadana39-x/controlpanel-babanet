import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export class PathTraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathTraversalError";
  }
}

export function assertPathInside(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const relativePath = relative(resolvedRoot, resolvedTarget);
  if (relativePath === "") return resolvedTarget;
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new PathTraversalError(`Path escapes its root: ${target}`);
  }
  return resolvedTarget;
}

export function safeJoin(root: string, relativePath: string): string {
  const normalized = normalize(relativePath).replace(/^([/\\])+/, "");
  if (normalized === "" || normalized === ".") return resolve(root);
  return assertPathInside(root, join(resolve(root), normalized));
}

export function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

export function sanitizeRelativeZipPath(entryName: string): string {
  const cleaned = entryName.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = cleaned.split("/");
  const filtered: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      throw new PathTraversalError(`Path traversal blocked in archive: ${entryName}`);
    }
    if (segment.includes("\0")) {
      throw new PathTraversalError(`Invalid path in archive: ${entryName}`);
    }
    filtered.push(segment);
  }
  return filtered.join("/");
}
