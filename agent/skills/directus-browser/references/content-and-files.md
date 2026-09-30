# Directus content and files reference

Last reviewed: 2026-09-30
Sources: `official-sources.md` -> Content and file docs; Directus 12 breaking changes.

Use this for Content module, collection pages, item pages, Files module, assets, folders, and file metadata.

## Content module

- The Content module lets users browse, filter, search, and edit items held in collections.
- A collection page displays items from one collection and may show related fields.
- An item page edits one record.
- Collection layouts, visible fields, sorting, filtering, and bookmarks can customize the view.

## Collection page operations

- Filtering supports field criteria and AND/OR groups.
- Dynamic variables include `$CURRENT_USER`, `$CURRENT_ROLE`, `$CURRENT_ROLES`, `$CURRENT_POLICIES`, `$NOW`, and `$NOW(...)`.
- If content versioning is enabled, a Published/Draft selector may appear.
- Directus 12 opens new versioned items in a virtual draft and switches published items into draft context before edits. New API guidance uses `?version=published`; legacy `?version=main` remains compatible.
- Draft mode can show item-less drafts and disables some actions such as batch editing, archiving, exporting, manual sorting, and running flows from the sidebar.
- Batch editing appears after selecting multiple items; avoid batch writes unless explicitly requested.
- Bookmarks are saved presets for collection layout, visible fields, sorting, filtering, and related view state.

## Item-page operation hints

- Use `browser_snapshot` to find form controls and save/cancel actions.
- Use `browser_execute_js` for exact values when form state is ambiguous.
- Prefer `data-collection`, `data-field`, and `data-primary-key` attributes when present.
- After saving, verify by checking save network response, saved UI state, or a fresh item read.
- Directus 12.2+ WYSIWYG uses Tiptap. Unsupported stored HTML can be normalized on edit/save; review the warning/diff before unlocking the field. Do not change untouched markup incidentally.

## Files module

- Files module shows the file library and virtual folders.
- Files may be uploaded through the Studio UI or API.
- File metadata is stored in the `directus_files` system collection.
- Folder metadata is stored in `directus_folders`.
- File permissions are configurable like regular collection data.
- Directus 12.4.0 has a non-admin folder-read regression that can break the File Library with HTTP 500; 12.4.1 fixes it. Do not widen permissions to work around that failure.

## Assets and access

- Assets are served through `/assets/<file-id>`.
- Optional SEO/download filename form: `/assets/<file-id>/<filename>`.
- Stored cookies can authenticate asset access when present.
- `access_token` query auth exists, but do not use or ask for static tokens unless explicitly authorized.
- Prefer Directus asset/API URLs over direct storage paths so permissions and image transformations apply.
- Transformed image assets can be requested with a `key` query parameter for configured presets. The default maximum output dimension is 3000 pixels in Directus 12.2 and 6000 in 12.3+; server configuration can override it.

## Upload safety

- Studio uploads can be interactive and visible; prefer UI upload unless API upload is explicitly requested.
- API upload uses `POST /files` multipart form data with file contents under a `file` property.
- API import from URL uses `POST /files/import`; treat it as an external fetch/write operation.
- Deleting a Directus file also deletes it from storage/disk; require explicit delete intent.
- Treat public/unauthenticated upload permissions as high risk.
