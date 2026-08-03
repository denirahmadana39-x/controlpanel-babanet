export interface SiteConfigInput {
  projectId: string;
  hostnames: string[];
  root: string;
  port?: number;
}

import { ENGINE_EXTENSIONS } from "@hosting/shared";

const STATIC_EXTENSIONS = [...ENGINE_EXTENSIONS.ALLOWED].join(" ");

export function generateSiteConfig(input: SiteConfigInput): string {
  const serverName = input.hostnames.join(" ");
  const port = input.port ?? 80;
  return `# Managed by Hosting Panel — project ${input.projectId}
# Do not edit manually; changes are overwritten on deploy.

server {
    listen ${port};
    listen [::]:${port};

    server_name ${serverName};

    root ${input.root};
    index index.html;

    access_log off;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ /\\. {
        deny all;
        return 404;
    }

    location ~* \\.(${STATIC_EXTENSIONS.replaceAll(" ", "|")})$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
`;
}
