import { describe, expect, it } from "vitest";
import { generateSiteConfig } from "./generator.js";

describe("generateSiteConfig", () => {
  it("writes server_name from hostnames", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com", "www.example.com"],
      root: "/var/www/sites/abc",
    });
    expect(config).toContain("server_name site.example.com www.example.com;");
  });

  it("writes the serve root and index", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com"],
      root: "/var/www/sites/abc",
    });
    expect(config).toContain("root /var/www/sites/abc;");
    expect(config).toContain("index index.html;");
  });

  it("applies security headers", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com"],
      root: "/x",
    });
    expect(config).toContain("X-Content-Type-Options nosniff");
    expect(config).toContain("X-Frame-Options SAMEORIGIN");
    expect(config).toContain("Referrer-Policy strict-origin-when-cross-origin");
  });

  it("blocks dotfiles", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com"],
      root: "/x",
    });
    expect(config).toContain("deny all;");
    expect(config).toContain("~ /\\.");
  });

  it("uses the configured port", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com"],
      root: "/x",
      port: 8080,
    });
    expect(config).toContain("listen 8080;");
  });

  it("defaults to port 80", () => {
    const config = generateSiteConfig({
      projectId: "abc",
      hostnames: ["site.example.com"],
      root: "/x",
    });
    expect(config).toContain("listen 80;");
  });
});
