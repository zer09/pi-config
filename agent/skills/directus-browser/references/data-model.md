# Directus data model reference

Last reviewed: 2026-07-09
Sources: `official-sources.md` -> Core Studio and data model docs.

Use this for Settings -> Data Model work: collections, fields, interfaces, displays, validation, conditions, and relationships.

## Concepts

- Collection = database table plus Directus metadata.
- User collections are project data models; system collections are prefixed `directus_`.
- Field = database column plus Directus metadata such as interface, display, validation, and conditions.
- Interface = Studio input/editing control for a field.
- Display = Studio rendering for a field value.
- Alias fields do not map directly to database columns; presentational fields and some relationships use aliases.

## Irreversible choices to confirm

Before creating schema, confirm:

- collection key/name and display label;
- primary key strategy;
- field keys and types;
- relationship cardinality and owning side;
- whether fields are required, unique, indexed, searchable, hidden, read-only, or validated;
- whether content versioning/accountability/archive/sort behavior is needed.

Directus constraints that matter for browser automation:

- Collection names are case-sensitive and immutable after creation. Display names/translations can change; the API/table key cannot.
- Primary key type/strategy is selected at collection creation and cannot be modified later.
- Field key and type are immutable after creation.
- Field creation usually starts by selecting an interface; the interface controls available types and configuration options.

## Interface hints

- Interface choice determines both how users edit values and which field types/configuration options are available.
- Common interfaces include Input, Textarea, WYSIWYG, Markdown, Toggle, Datetime, Repeater, Map, Dropdown, Tags, and relational interfaces.
- Some interfaces can have security-relevant options, such as external Autocomplete URLs or static access tokens for rich-text asset rendering; avoid configuring these casually.
- Time fields vary by type: `Timestamp` normalizes to UTC, while `DateTime` stores without timezone information and depends on database/server timezone behavior.

## Field configuration sections

Common field configuration sections:

- Schema: database column settings such as key, type, length, default, nullable, unique, indexed, and searchable.
- Field: Studio-facing details such as read-only, required, note/help text, and field-name translations.
- Interface: how users create/edit values.
- Display: how values are rendered in Studio.
- Validation: Studio and server validation rules/messages.
- Conditions: conditional hidden/read-only/required/interface behavior based on other field values.
- Relationships & Translations: relationship-specific settings and relational triggers.

Directus item-page field wrappers may expose `data-collection`, `data-field`, and `data-primary-key`; prefer these for precise DOM identification over generated classes.

## Relationships

- M2O: many items in one collection reference one item in another collection. Adds a real field/column on the many side.
- O2M: virtual alias view of the many side from the one side. Does not add a database column.
- M2M: creates/uses a junction collection with two foreign keys.
- M2A: alias plus junction collection that can reference items across multiple collections.
- Translations: creates an O2M alias plus language/junction infrastructure; Directus has a translations wizard.

For relationship changes, identify:

- owning collection;
- related collection(s);
- whether a junction collection will be created or reused;
- whether an alias field will be created;
- sort field behavior for relational sorting;
- relational trigger behavior for deselected/deleted related values.

## System collections to recognize

Common system collections:

- `directus_users` — users.
- `directus_files` — file metadata.
- `directus_folders` — virtual file folders.
- `directus_roles` — roles.
- `directus_policies` — policies.
- `directus_permissions` — access permissions.
- `directus_flows` and `directus_operations` — automations.
- `directus_collections`, `directus_fields`, `directus_relations` — data model metadata.

System collection fields required by Directus cannot be altered, but system collections can be extended with additional fields.
