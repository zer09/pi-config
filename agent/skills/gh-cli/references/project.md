# gh project

Source: https://cli.github.com/manual/gh_project
Generated from: `gh version 2.95.0 (2026-06-20)` via `gh help project`.

## Summary

Work with GitHub Projects.

## Subcommands

- [`close`](project/close.md) - Close a project
- [`copy`](project/copy.md) - Copy a project
- [`create`](project/create.md) - Create a project
- [`delete`](project/delete.md) - Delete a project
- [`edit`](project/edit.md) - Edit a project
- [`field-create`](project/field-create.md) - Create a field in a project
- [`field-delete`](project/field-delete.md) - Delete a field in a project
- [`field-list`](project/field-list.md) - List the fields in a project
- [`item-add`](project/item-add.md) - Add a pull request or an issue to a project
- [`item-archive`](project/item-archive.md) - Archive an item in a project
- [`item-create`](project/item-create.md) - Create a draft issue item in a project
- [`item-delete`](project/item-delete.md) - Delete an item from a project by ID
- [`item-edit`](project/item-edit.md) - Edit an item in a project
- [`item-list`](project/item-list.md) - List the items in a project
- [`link`](project/link.md) - Link a project to a repository or a team
- [`list`](project/list.md) - List the projects for an owner
- [`mark-template`](project/mark-template.md) - Mark a project as a template
- [`unlink`](project/unlink.md) - Unlink a project from a repository or a team
- [`view`](project/view.md) - View a project

## Manual

```text
Work with GitHub Projects.

The minimum required scope for the token is: `project`.
You can verify your token scope by running `gh auth status` and
add the `project` scope by running `gh auth refresh -s project`.


USAGE
  gh project <command> [flags]

AVAILABLE COMMANDS
  close:         Close a project
  copy:          Copy a project
  create:        Create a project
  delete:        Delete a project
  edit:          Edit a project
  field-create:  Create a field in a project
  field-delete:  Delete a field in a project
  field-list:    List the fields in a project
  item-add:      Add a pull request or an issue to a project
  item-archive:  Archive an item in a project
  item-create:   Create a draft issue item in a project
  item-delete:   Delete an item from a project by ID
  item-edit:     Edit an item in a project
  item-list:     List the items in a project
  link:          Link a project to a repository or a team
  list:          List the projects for an owner
  mark-template: Mark a project as a template
  unlink:        Unlink a project from a repository or a team
  view:          View a project

INHERITED FLAGS
  --help   Show help for command

EXAMPLES
  $ gh project create --owner monalisa --title "Roadmap"
  $ gh project view 1 --owner cli --web
  $ gh project field-list 1 --owner cli
  $ gh project item-list 1 --owner cli

LEARN MORE
  Use `gh <command> <subcommand> --help` for more information about a command.
  Read the manual at https://cli.github.com/manual
  Learn about exit codes using `gh help exit-codes`
  Learn about accessibility experiences using `gh help accessibility`
```
