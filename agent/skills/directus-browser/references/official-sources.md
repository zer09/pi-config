# Official Directus sources

Last reviewed: 2026-07-09

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
- Upload files: https://directus.com/docs/guides/files/upload
- Access files: https://directus.com/docs/guides/files/access
- Files API: https://directus.com/docs/api/files

## Flow docs

- Flows: https://directus.com/docs/guides/flows
- Operations: https://directus.com/docs/guides/flows/operations
- Data chain: https://directus.com/docs/guides/flows/data-chain
- Flows API: https://directus.com/docs/api/flows

## Access-control docs

- Access control: https://directus.com/docs/guides/auth/access-control
- Users API: https://directus.com/docs/api/users
- Roles API: https://directus.com/docs/api/roles
- Policies API: https://directus.com/docs/api/policies
- Permissions API: https://directus.com/docs/api/permissions

## AI/MCP and security docs

- AI + Directus: https://directus.com/docs/guides/ai
- Directus MCP: https://directus.com/docs/guides/ai/mcp
- MCP installation: https://directus.com/docs/guides/ai/mcp/installation
- MCP security: https://directus.com/docs/guides/ai/mcp/security
- Local MCP alternative: https://directus.com/docs/guides/ai/mcp/local-mcp
- Directus `llms.txt`: https://directus.com/llms.txt

## Source refresh protocol

When updating this skill:

1. Re-check the official Directus docs relevant to the changed behavior.
2. Update the matching local distilled reference file.
3. Update each changed reference file's `Last reviewed` date.
4. Add newly important official URLs here.
5. Preserve local safety gates even if official examples show broader API or MCP access.
6. Do not paste real project URLs, credentials, cookies, or Directus tokens into references.
