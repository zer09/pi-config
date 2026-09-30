# Official Directus sources

Last reviewed: 2026-09-30

Keep this inventory current when updating the skill. These official docs are source input for the local distilled references, not text to copy wholesale.

## Core Studio and data model docs

- Data model guide: https://directus.com/docs/getting-started/data-model
- Collections: https://directus.com/docs/guides/data-model/collections
- Fields: https://directus.com/docs/guides/data-model/fields
- Relationships: https://directus.com/docs/guides/data-model/relationships
- Interfaces: https://directus.com/docs/guides/data-model/interfaces

## Schema API docs

- Server info and OpenAPI spec: https://directus.com/docs/api/server
- Collections API: https://directus.com/docs/api/collections
- Fields API: https://directus.com/docs/api/fields
- Relations API: https://directus.com/docs/api/relations

## Content and file docs

- Collection page / content explore: https://directus.com/docs/guides/content/explore
- Item page: https://directus.com/docs/guides/content/editor
- Upload files: https://directus.com/docs/guides/files/upload
- Access files: https://directus.com/docs/guides/files/access
- Transform files: https://directus.com/docs/guides/files/transform
- Files API: https://directus.com/docs/api/files

## Flow docs

- Flows: https://directus.com/docs/guides/flows
- Manage Flows: https://directus.com/docs/guides/flows/manage-flows
- Operations: https://directus.com/docs/guides/flows/operations
- Data chain: https://directus.com/docs/guides/flows/data-chain
- Flows API: https://directus.com/docs/api/flows

## Access-control docs

- Access control: https://directus.com/docs/guides/auth/access-control
- Users API: https://directus.com/docs/api/users
- Roles API: https://directus.com/docs/api/roles
- Policies API: https://directus.com/docs/api/policies
- Permissions API: https://directus.com/docs/api/permissions

## Releases, AI/MCP, and security docs

- Directus changelog: https://directus.com/docs/releases/changelog
- Directus 12 breaking changes: https://directus.com/docs/releases/breaking-changes/version-12
- AI + Directus: https://directus.com/docs/guides/ai
- Directus MCP: https://directus.com/docs/guides/ai/mcp
- MCP installation: https://directus.com/docs/guides/ai/mcp/installation
- MCP OAuth registration: https://directus.com/docs/guides/ai/mcp/oauth
- MCP security: https://directus.com/docs/guides/ai/mcp/security
- Local MCP alternative: https://directus.com/docs/guides/ai/mcp/local-mcp
- Directus documentation index: https://directus.com/docs/llms.txt

## Current comparison

On 2026-09-30, compared every retained reference against the relevant pages above, including the changelog and Directus 12 breaking changes through 12.4.1. This is a current-doc comparison with local guidance, not an upstream diff: no historical remote snapshot is retained. See the [review decisions](../../../../docs/skills/directus-browser-update-process.md#official-source-comparison-2026-09-30).

Guide/release pages expose Markdown via `.md`; API pages were compared as HTML because their `.md` URLs returned 404. The listed API page paths still return 200. The root `https://directus.com/llms.txt` now indexes the product site; use the documentation index above for source discovery.

## Source refresh protocol

When updating this skill:

1. Re-check the official Directus docs relevant to the changed behavior.
2. Compare the matching local distilled reference; change runtime guidance only when the evidence requires it.
3. Update `Last reviewed` only for references actually compared, including verified no-ops.
4. Add newly important official URLs here.
5. Preserve local safety gates even if official examples show broader API or MCP access.
6. Do not paste real project URLs, credentials, cookies, or Directus tokens into references.
