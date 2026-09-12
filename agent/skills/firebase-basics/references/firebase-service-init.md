# Initialization

Inspect `firebase.json`, `.firebaserc`, and existing product configuration before choosing a setup action. Dependency-only and existing-config tasks do not require CLI authentication, CLI download/install, project creation, app registration, or CLI initialization.

Use the installed or repository-pinned Firebase CLI only when needed. If it is absent, report it and ask before download/install. Login and active-project changes require user request or agreement.

1. **Project Directory:**
   Navigate to the root directory of the codebase. 
   *(Only if starting a completely new project from scratch without an existing codebase, create a directory first: `mkdir my-project && cd my-project`)*

2. **Optional: Initialize only the requested product:**
   Require explicit authorization for local initialization of the exact product and identified existing project before running the command below. Replace `<PRODUCT>` with only the requested product, not an unrestricted feature selection.

   Project creation, app registration, and service enablement each need separate explicit authorization for the exact action and target. Stop before such prompts; local initialization does not authorize hosted mutations.
   ```bash
   firebase init <PRODUCT> --project <PROJECT_ID>
   ```

Preserve existing configuration files. Do not add unrelated products or create a missing project to complete local work. Report any unapproved hosted setup as deferred.
