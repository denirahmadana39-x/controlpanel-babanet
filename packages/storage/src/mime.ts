import { lookup } from "mime-types";

const OVERRIDES: Record<string, string> = {
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  wasm: "application/wasm",
  txt: "text/plain",
  xml: "text/xml",
  webp: "image/webp",
  avif: "image/avif",
  webm: "video/webm",
  mp4: "video/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

export function mimeTypeFor(filename: string): string | null {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const override = OVERRIDES[extension];
  if (override !== undefined) return override;
  const detected = lookup(base);
  return detected || null;
}
