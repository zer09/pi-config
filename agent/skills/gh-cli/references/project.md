# gh project

Source: https://cli.github.com/manual/gh_project
Generated from: `gh version 2.92.0 (2026-04-28)` via `gh help project`.

## Summary

Work with GitHub Projects.

## Subcommands

- `gh project close` - Close a project - [reference](project/close.md)
- `gh project copy` - Copy a project - [reference](project/copy.md)
- `gh project create` - Create a project - [reference](project/create.md)
- `gh project delete` - Delete a project - [reference](project/delete.md)
- `gh project edit` - Edit a project - [reference](project/edit.md)
- `gh project field-create` - Create a field in a project - [reference](project/field-create.md)
- `gh project field-delete` - Delete a field in a project - [reference](project/field-delete.md)
- `gh project field-list` - List the fields in a project - [reference](project/field-list.md)
- `gh project item-add` - Add a pull request or an issue to a project - [reference](project/item-add.md)
- `gh project item-archive` - Archive an item in a project - [reference](project/item-archive.md)
- `gh project item-create` - Create a draft issue item in a project - [reference](project/item-create.md)
- `gh project item-delete` - Delete an item from a project by ID - [reference](project/item-delete.md)
- `gh project item-edit` - Edit an item in a project - [reference](project/item-edit.md)
- `gh project item-list` - List the items in a project - [reference](project/item-list.md)
- `gh project link` - Link a project to a repository or a team - [reference](project/link.md)
- `gh project list` - List the projects for an owner - [reference](project/list.md)
- `gh project mark-template` - Mark a project as a template - [reference](project/mark-template.md)
- `gh project unlink` - Unlink a project from a repository or a team - [reference](project/unlink.md)
- `gh project view` - View a project - [reference](project/view.md)

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
