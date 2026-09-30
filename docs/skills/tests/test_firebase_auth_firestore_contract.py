"""Offline Auth/Firestore documentation contracts; never launch Firebase or SDKs."""

import argparse
import ast
import json
import operator
import os
import re
import shlex
import shutil
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SKILLS = REPO / "agent/skills"
PACKAGE = None


def client_setup_errors(text):
    forbidden = ("firebase-tools@latest", "init auth", "init firestore")
    errors = [term for term in forbidden if term in text]
    if "does not require CLI installation, CLI initialization, provisioning, or live authentication" not in text:
        errors.append("missing local-only boundary")
    return errors


def hosted_command_errors(text):
    errors = []
    for block in re.finditer(r"```bash\n(.*?)```", text, re.DOTALL):
        commands = block.group(1).replace("\\\n", " ").splitlines()
        # Require the gate before the recipe, within the same named section.
        section = text[:block.start()].rsplit("\n## ", 1)[-1].lower()
        for command in commands:
            if not command.startswith("firebase "):
                continue
            tokens = shlex.split(command)
            if tokens[1] not in ("deploy", "firestore:databases:create"):
                continue
            if not all(term in section for term in ("explicit authorization", "exact", "project/database")):
                errors.append("missing action/target gate")
            if "--project" not in tokens:
                errors.append("missing project")
            if tokens[1] == "deploy" and "--config" not in tokens:
                errors.append("missing single-database config")
            if tokens[1] == "firestore:databases:create":
                if not all(any(t.startswith(flag + "=") or t == flag for t in tokens)
                           for flag in ("--edition", "--location")):
                    errors.append("missing edition/location")
                if "native access mode" not in section:
                    errors.append("missing access-mode decision")
    return errors


def optional_string_fake(rules, data, field, min_len, max_len):
    bodies = re.findall(
        r"function isValidOptionalString\(field, minLen, maxLen\)\s*\{([^{}]+)\}", rules,
    )
    if len(bodies) != 1:
        raise AssertionError("Expected one optional-string helper")
    # Parse only this helper's supported expression, not general Firestore Rules.
    expression = " ".join(bodies[0].split())
    parsed = re.fullmatch(
        r"return !\((field|'[^']*') in request\.resource\.data\) \|\| "
        r"\(request\.resource\.data\[field\] is string && "
        r"request\.resource\.data\[field\]\.size\(\) (>=?) minLen && "
        r"request\.resource\.data\[field\]\.size\(\) (<=?) maxLen\);",
        expression,
    )
    if parsed is None:
        raise AssertionError("Unsupported optional-string expression")
    key, minimum, maximum = parsed.groups()
    presence_key = field if key == "field" else ast.literal_eval(key)
    if presence_key not in data:
        return True
    # A missing selected value cannot pass the string guard.
    value = data.get(field)
    comparisons = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le}
    return (isinstance(value, str)
            and comparisons[minimum](len(value), min_len)
            and comparisons[maximum](len(value), max_len))


class AuthContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = SKILLS / "firebase-auth-basics"
        cls.root = (cls.skill / "SKILL.md").read_text()
        cls.refs = {p.stem: p.read_text() for p in (cls.skill / "references").glob("*.md")}

    def test_routing_authorization_and_completion(self):
        for term in ("Not Firebase CLI login", "existing app initialization", "Load only",
                     "references/ios_setup.md", "review is read-only", "live bypass",
                     "exact action and target project/environment", "email/SMS",
                     "Validation and completion", "Fix failures", "Stop the affected action"):
            self.assertIn(term, self.root)
        self.assertIn("not application user sign-in", (SKILLS / "firebase-basics/SKILL.md").read_text())
        self.assertNotIn("firebase deploy", self.root)

    def test_client_setup_and_rejected_ungated_recipes(self):
        for name in ("client_sdk_android", "client_sdk_web", "flutter_setup", "ios_setup"):
            with self.subTest(reference=name):
                self.assertFalse(client_setup_errors(self.refs[name]))
        android = self.refs["client_sdk_android"]
        for term in ("google-services.json", "applicationId", "build variant", "Gradle plugin",
                     "compatible pinned BoM", "version catalog", "convention plugins",
                     "./gradlew --offline", "dependencyInsight", "report the limit",
                     "do not force the latest version", "auth = Firebase.auth"):
            self.assertIn(term, android)
        self.assertNotIn(".ktx", android)
        activity = android.split("#### Jetpack Compose", 1)[0]
        self.assertNotIn("val auth = Firebase.auth", activity)
        for recipe in ("npx -y firebase-tools@latest init auth", "firebase init firestore"):
            self.assertTrue(client_setup_errors(android + "\n" + recipe))
        self.assertTrue(client_setup_errors("Install and log in to Firebase before client setup."))

    def test_flutter_and_domain_fixes(self):
        flutter = self.refs["flutter_setup"]
        for term in ("Future<void> initialize() async", "await GoogleSignIn.instance.initialize()",
                     "final GoogleSignInAccount googleUser", "googleUser.authentication;",
                     "ownership filters, ordering, and limits", "unbounded collection",
                     "limited unsorted subset", "client_sdk_web.md#troubleshooting-authunauthorized-domain"):
            self.assertIn(term, flutter)
        self.assertNotIn("await googleUser.authentication", flutter)
        self.assertNotIn("AuthService() {", flutter)
        web = self.refs["client_sdk_web"]
        for term in ("auth/unauthorized-domain", "not a scheme or port", "OAuth redirect URIs",
                     "exact action, domain, and target project/environment", "without changing hosted settings"):
            self.assertIn(term, web)

    def test_rules_ownership_validation_and_query_limits(self):
        rules = self.refs["security_rules"]
        for term in ("audits are read-only", "do not cover Cloud Storage", "client-writable",
                     "allow create: if signedIn() && validNote(request.resource.data)",
                     "request.resource.data.owner_uid == request.auth.uid",
                     "allow update: if ownsExisting() && validNote(request.resource.data)",
                     "request.resource.data.owner_uid == resource.data.owner_uid",
                     "data.keys().hasAll", "data.keys().hasOnly", "data.body.size() <= 2000",
                     "request.query.limit <= 50", "Rules are not filters", "another user's data",
                     "do not exercise live bypasses or deploy as validation"):
            self.assertIn(term, rules)
        self.assertNotRegex(rules, r"allow read, write: if request.auth != null;")
        self.assertNotIn("firebase-firestore-basics", rules)
        self.assertNotIn("firestore-rules-author", rules)


class FirestoreAndroidContract(unittest.TestCase):
    def test_android_local_setup_and_modern_initialization(self):
        for edition in ("standard", "enterprise"):
            text = (SKILLS / f"firebase-firestore/references/{edition}/android_sdk_usage.md").read_text()
            with self.subTest(edition=edition):
                self.assertFalse(client_setup_errors(text))
                for term in ("applicationId", "build variant", "google-services.json", "Gradle plugin",
                             "compatible pinned BoM", "version catalog", "./gradlew --offline",
                             "dependencyInsight", "do not force the latest version",
                             "exact action and target project/database", ".limit(50)"):
                    self.assertIn(term, text)
                self.assertNotIn(".ktx", text)
                self.assertNotIn("val db =", text.split("#### Jetpack Compose", 1)[0])
                self.assertNotIn("<latest_bom_version>", text)

    def test_named_enterprise_database_and_optional_pipelines(self):
        text = (SKILLS / "firebase-firestore/references/enterprise/android_sdk_usage.md").read_text()
        self.assertEqual(text.count('FirebaseFirestore.getInstance("my-database-id")'), 2)
        self.assertNotIn("Firebase.firestore", text)
        for term in ("verified/configured Enterprise database ID", "resolved SDK version",
                     "pipeline.docs.txt", "expressions.docs.txt", "Kotlin uses `.alias(...)`",
                     "SearchStage.withQuery", ".limit(5)", "ownership filters, query ordering, and limits",
                     "Keep standard queries", "report the evidence gap"):
            self.assertIn(term, text)
        self.assertNotIn("MANDATORY PIPELINE", text)


class FirestoreClientContract(unittest.TestCase):
    def test_clients_need_no_cli_or_live_setup(self):
        for edition in ("standard", "enterprise"):
            for name in ("android_sdk_usage", "web_sdk_usage", "flutter_setup", "ios_setup"):
                text = (SKILLS / f"firebase-firestore/references/{edition}/{name}.md").read_text()
                with self.subTest(edition=edition, reference=name):
                    self.assertFalse(client_setup_errors(text))
                    self.assertIn("exact action and target project/database", text)
                    self.assertIn("ownership filters, query ordering, and limits", text)

    def test_enterprise_identity_in_each_sdk(self):
        refs = SKILLS / "firebase-firestore/references/enterprise"
        examples = {
            "web_sdk_usage": 'getFirestore(app, "my-database-id")',
            "python_sdk_usage": 'firestore.Client(project="<project-id>", database="my-database-id")',
            "android_sdk_usage": 'FirebaseFirestore.getInstance("my-database-id")',
            "ios_setup": 'Firestore.firestore(database: "your-enterprise-database-id")',
            "flutter_setup": "databaseId: 'my-database-id'",
        }
        for name, example in examples.items():
            text = (refs / f"{name}.md").read_text()
            with self.subTest(reference=name):
                self.assertIn("verified/configured Enterprise database ID", text)
                self.assertIn(example, text)
        python = (refs / "python_sdk_usage.md").read_text()
        self.assertIn("db.pipeline()", python)
        self.assertNotIn("client.pipeline()", python)
        self.assertIn("IAM rather than client Security Rules", python)
        web = (refs / "web_sdk_usage.md").read_text()
        self.assertNotIn("getFirestore(app)", web)
        self.assertIn("pipelines.d.ts", web)
        self.assertIn("locate the file in the installed version", web)
        self.assertEqual(web.count("await execute("), 2)
        ios = (refs / "ios_setup.md").read_text()
        safe_pattern = next(line for line in ios.splitlines() if line.startswith("- **SAFE PATTERN:**"))
        with self.subTest(ios="named initialization after configuration"):
            self.assertNotIn("Firestore.firestore()", safe_pattern)
            self.assertNotIn("lazy", safe_pattern)
            self.assertIn(examples["ios_setup"], safe_pattern)
            self.assertIn("after `FirebaseApp.configure()` finishes", safe_pattern)
        with self.subTest(ios="optional authenticated UID transitions"):
            for term in ("Key `.task(id:)` to the optional authenticated UID",
                         "For a present or changed UID, call `startListening(for:)`",
                         "clear the previous user's data before restarting on an identity change",
                         "For an absent UID, call `stopListening()` and clear user data",
                         "Neither `deinit` nor task cancellation substitutes for this identity handling"):
                self.assertIn(term, ios)

    def test_flutter_query_order_and_limits(self):
        for edition in ("standard", "enterprise"):
            text = (SKILLS / f"firebase-firestore/references/{edition}/flutter_setup.md").read_text()
            for method in ("fetchItems", "streamItems"):
                body = text.split(method + "(String ownerId)", 1)[1].split("\n  }", 1)[0]
                with self.subTest(edition=edition, method=method):
                    self.assertLess(body.index(".where('ownerId'"), body.index(".orderBy("))
                    self.assertLess(body.index(".orderBy("), body.index(".limit(50)"))
                    self.assertNotIn(".sort(", body)
            self.assertIn("limited unsorted subset", text)

    def test_standard_flutter_database_selection_and_injection(self):
        text = (SKILLS / "firebase-firestore/references/standard/flutter_setup.md").read_text()
        initialization = text.split("### Initialization & References", 1)[1].split("\n---", 1)[0]
        for term in ("Firebase.initializeApp", "Standard is an edition, not a database ID",
                     "Only when the verified target is `(default)`",
                     "named Standard database", "verified/configured Standard database ID"):
            self.assertIn(term, initialization)
        code = "\n".join(re.findall(r"```dart\n(.*?)```", text, re.DOTALL))
        self.assertIn("import 'package:firebase_core/firebase_core.dart';", code)
        self.assertRegex(initialization, r"Only when the verified target is `\(default\)`:\s*"
                         r"```dart\nfinal itemService = ItemService\(FirebaseFirestore\.instance\);")
        self.assertEqual(re.findall(r"FirebaseFirestore\.(instance(?:For)?)\b", code),
                         ["instance", "instanceFor"])
        self.assertRegex(code, r"final itemService = ItemService\(\s*"
                         r"FirebaseFirestore\.instanceFor\(\s*app: Firebase\.app\(\),\s*"
                         r"databaseId: 'my-database-id',\s*\),\s*\);")
        service = next(block for block in re.findall(r"```dart\n(.*?)```", text, re.DOTALL)
                       if "class ItemService {" in block)
        self.assertIn("final FirebaseFirestore _db;", service)
        self.assertIn("ItemService(FirebaseFirestore db) : _db = db;", service)
        self.assertEqual(service.count("ItemService("), 1)
        self.assertEqual(re.findall(r"\b_db\s*=\s*([^;]+);", service), ["db"])
        self.assertNotIn("FirebaseFirestore.", service)
        self.assertNotIn("??", service)
        self.assertEqual(service.count("_db."), 1)
        self.assertIn("CollectionReference get _itemsRef => _db.collection('items');", service)
        for signature in ("createItem(Item item)", "fetchItems(String ownerId)",
                          "streamItems(String ownerId)", "updateItemName(String id, String newName)",
                          "deleteItem(String id)"):
            body = service.split(signature, 1)[1].split("\n  }", 1)[0]
            with self.subTest(method=signature):
                self.assertIn("_itemsRef", body)
                if signature.startswith(("fetchItems", "streamItems")):
                    self.assertIn(".where('ownerId', isEqualTo: ownerId)", body)
                    self.assertIn(".orderBy('createdAt', descending: true)", body)
                    self.assertIn(".limit(50)", body)

    def test_standard_ios_database_selection_and_injection(self):
        text = (SKILLS / "firebase-firestore/references/standard/ios_setup.md").read_text()

        def assert_contract(reference):
            initialization = reference.split("## 1. Import and Initialize", 1)[1].split("## 2.", 1)[0]
            for term in ("after `FirebaseApp.configure()`", "choose exactly one",
                         "Standard is an edition, not a database ID",
                         "Only when the verified target is `(default)`",
                         "verified/configured Standard database ID"):
                self.assertIn(term, initialization)
            self.assertRegex(initialization, r"Only when the verified target is `\(default\)`:\s*"
                             r"```swift\nlet db = Firestore\.firestore\(\)\n```")
            self.assertRegex(initialization, r"Otherwise, for a named Standard database, "
                             r"use its verified/configured Standard database ID:\s*"
                             r'```swift\nlet db = Firestore\.firestore\(database: "my-database-id"\)\n```')
            # Only Swift fences count as code; comments cannot satisfy the contract.
            blocks = [re.sub(r"//[^\n]*|/\*.*?\*/", "", block, flags=re.DOTALL)
                      for block in re.findall(r"^```swift\n(.*?)^```", reference, re.MULTILINE | re.DOTALL)]
            code = "\n".join(blocks)
            self.assertEqual(re.findall(r"\bFirestore\s*\.\s*firestore\s*\(([^()]*)\)", code),
                             ["", 'database: "my-database-id"'])
            managers = [block for block in blocks if "final class DataManager {" in block]
            views = [block for block in blocks if "struct MyView: View {" in block]
            self.assertEqual(len(managers), 1)
            self.assertEqual(len(views), 1)
            manager, view = managers[0], views[0]
            self.assertRegex(manager, r"(?m)^    private let db: Firestore$")
            self.assertRegex(view, r"(?m)^    @State private var manager: DataManager$")
            for block in (manager, view):
                self.assertEqual(len(re.findall(r"\binit\s*\(", block)), 1)
                self.assertNotRegex(block, r"\bFirestore\s*\.")
                self.assertNotIn("??", block)
            self.assertEqual(re.findall(r"\b(?:self\.)?db\s*=\s*([^\n}]+)", manager), ["db"])
            manager = " ".join(manager.split())
            view = " ".join(view.split())
            for required in (
                "init(db: Firestore) { self.db = db }",
                ("func startListening(for userId: String) { stopListening() "
                 'listenerHandle = db.collection("users").document(userId).addSnapshotListener '
                 "{ snapshot, error in } }"),
                "func stopListening() { listenerHandle?.remove() listenerHandle = nil }",
                "isolated deinit { stopListening() }",
            ):
                self.assertIn(required, manager)
            self.assertIn("init(db: Firestore) { _manager = State(initialValue: DataManager(db: db)) }", view)
            self.assertEqual(re.findall(r"\bDataManager\(([^()]*)\)", code), ["db: db"])
            self.assertIn(".task(id: authManager.userId) { if let userId = authManager.userId { "
                          "manager.startListening(for: userId) } else { manager.stopListening() } }", view)
            self.assertNotIn(".onDisappear", view)
            self.assertEqual(re.findall(r"\bMyView\(([^()]*)\)", code), ["db: db"])

        assert_contract(text)
        fixtures = {
            "unverified default": ("Only when the verified target is `(default)`:", "Default:"),
            "unconditional choices": ("choose exactly one", "use both"),
            "wrong named target": ('database: "my-database-id"', 'database: "(default)"'),
            "internal default factory": ('db.collection("users").document(userId)',
                                         'Firestore.firestore().collection("users").document(userId)'),
            "internal named factory": ('db.collection("users").document(userId)',
                                       ('Firestore.firestore(database: "my-database-id")'
                                        '.collection("users").document(userId)')),
            "lazy factory": ("private let db: Firestore", "private lazy var db = Firestore.firestore()"),
            "optional property": ("private let db: Firestore", "private let db: Firestore?"),
            "optional manager injection": ("init(db: Firestore) {\n        self.db = db",
                                           "init(db: Firestore?) {\n        self.db = db"),
            "default manager injection": ("init(db: Firestore) {\n        self.db = db",
                                          "init(db: Firestore = Firestore.firestore()) {\n        self.db = db"),
            "fallback injection": ("self.db = db", "self.db = db ?? fallbackDB"),
            "optional view injection": ("init(db: Firestore) {\n        _manager",
                                        "init(db: Firestore?) {\n        _manager"),
            "default view injection": ("init(db: Firestore) {\n        _manager",
                                       "init(db: Firestore = defaultDB) {\n        _manager"),
            "parameterless manager": ("DataManager(db: db)", "DataManager()"),
            "parameterless view": ("MyView(db: db)", "MyView()"),
            "removed restart": ("        stopListening()\n        \n        // 2.", "        // 2."),
            "removed remove": ("listenerHandle?.remove()", ""),
            "removed clear": ("listenerHandle = nil", ""),
            "removed deinit": ("isolated deinit {\n        stopListening()\n    }", ""),
            "nonisolated deinit": ("isolated deinit", "deinit"),
            "wrong collection": ('db.collection("users").document(userId)',
                                 'db.collection("profiles").document(userId)'),
            "wrong document": (".document(userId)", '.document("other-user")'),
            "replaced task": (".task(id: authManager.userId)", ".onDisappear"),
            "unkeyed task": (".task(id: authManager.userId)", ".task"),
            "removed signout cleanup": ("manager.stopListening()", ""),
            "commented initializer": ("self.db = db", "/* self.db = db */"),
            "prose instead of Swift": ("```swift\nstruct MyView", "```text\nstruct MyView"),
        }
        for label, (old, new) in fixtures.items():
            with self.subTest(fixture=label):
                self.assertEqual(text.count(old), 1)
                with self.assertRaises(AssertionError):
                    assert_contract(text.replace(old, new))

    def test_javascript_and_python_snippet_syntax_without_execution(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required for parser-only checks")
        count = 0
        for skill in ("firebase-auth-basics", "firebase-firestore"):
            for path in (SKILLS / skill / "references").rglob("*.md"):
                if path.name == "security_rules.md":
                    continue  # Firestore Rules are not JavaScript.
                for language, code in re.findall(r"```(javascript|python)\n(.*?)```", path.read_text(), re.DOTALL):
                    with self.subTest(path=path.relative_to(SKILLS), snippet=count):
                        if language == "python":
                            ast.parse(code)
                        else:
                            result = subprocess.run(
                                [node, "--input-type=module", "--check"], input=code,
                                capture_output=True, text=True, check=False,
                                env={"PATH": os.defpath}, timeout=10,
                            )
                            self.assertEqual(result.returncode, 0, result.stderr)
                        count += 1
        self.assertGreater(count, 25)


class FirestoreSafetyContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = SKILLS / "firebase-firestore"
        cls.root = (cls.skill / "SKILL.md").read_text()

    def test_local_first_edition_and_audit_routing(self):
        for term in ("Inspect `firebase.json`, `.firebaserc`", "without live CLI discovery",
                     "when needed, read-only CLI metadata", "Native access mode alone",
                     "Do not default to Enterprise", "missing database is not permission",
                     "Audits are read-only", "test-file creation", "Do not deploy as a validation shortcut",
                     "Fix failures caused by the change", "Report missing evidence or tooling"):
            self.assertIn(term, self.root)
        self.assertLess(self.root.index("Inspect `firebase.json`"), self.root.index("firestore:databases:list"))
        self.assertNotIn("firestore:databases:create", self.root)
        self.assertNotIn("firestore-rules-author", self.root)

    def test_creation_and_deployment_gates_reject_unsafe_examples(self):
        for edition in ("standard", "enterprise"):
            for name in ("provisioning", "indexes"):
                text = (self.skill / f"references/{edition}/{name}.md").read_text()
                with self.subTest(edition=edition, reference=name):
                    self.assertFalse(hosted_command_errors(text))
                    self.assertIn("<single-database-config>", text)
                    self.assertNotIn("firebase-tools@latest", text)
            provisioning = (self.skill / f"references/{edition}/provisioning.md").read_text()
            for term in ("exact project, database ID, edition, access mode, and location",
                         "Do not use deployment to create it implicitly", "target is missing, stop",
                         "Service enablement also needs separate exact authorization",
                         "before database filtering", "preserve the original multi-database config"):
                self.assertIn(term, provisioning)
            self.assertTrue(hosted_command_errors(provisioning.replace("explicit authorization", "approval")))
            self.assertTrue(hosted_command_errors(provisioning.replace(" --config <single-database-config>", "")))
        for command in ("firebase firestore:databases:create demo", "firebase deploy --only firestore"):
            self.assertTrue(hosted_command_errors("```bash\n" + command + "\n```"))

    def test_rules_preserve_ownership_query_and_limit_checks(self):
        for edition in ("standard", "enterprise"):
            rules = (self.skill / f"references/{edition}/security_rules.md").read_text()
            for term in ("audits are read-only", "not live bypass attempts", "Rules are not filters",
                         "request.query.limit", "loosen ownership checks", "create", "update",
                         "Enforce Size Limits", "Ownership Hijacking", "Privilege Escalation",
                         "Validate rules locally", "Do not use deployment as a syntax check"):
                with self.subTest(edition=edition, term=term):
                    self.assertIn(term, rules)
            self.assertNotIn("Prefer using `read` over them", rules)

    def test_optional_string_source_fake_matrix(self):
        for edition in ("standard", "enterprise"):
            rules = (self.skill / f"references/{edition}/security_rules.md").read_text()
            for field in ("displayName", "bio"):
                cases = (
                    ("absent", {}, True),
                    ("minimum", {field: "ab"}, True),
                    ("middle", {field: "abc"}, True),
                    ("maximum", {field: "abcd"}, True),
                    ("number", {field: 123}, False),
                    ("null", {field: None}, False),
                    ("list", {field: ["ab"]}, False),
                    ("empty", {field: ""}, False),
                    ("undersized", {field: "a"}, False),
                    ("oversized", {field: "abcde"}, False),
                )
                for name, data, expected in cases:
                    for unrelated in ({}, {"field": None}, {"field": "unrelated"}):
                        with self.subTest(edition=edition, field=field, case=name, unrelated=unrelated):
                            self.assertEqual(
                                optional_string_fake(rules, {**data, **unrelated}, field, 2, 4),
                                expected,
                            )

    def test_documented_cli_flags_match_source_without_execution(self):
        package = json.loads((PACKAGE / "package.json").read_text())
        self.assertEqual((package["name"], package["version"]), ("firebase-tools", "15.32.0"))
        count = 0
        for path in self.skill.rglob("*.md"):
            for block in re.findall(r"```bash\n(.*?)```", path.read_text(), re.DOTALL):
                for line in block.replace("\\\n", " ").splitlines():
                    if not line.startswith("firebase "):
                        continue
                    tokens = shlex.split(line)
                    source = (PACKAGE / "lib/commands" / (tokens[1].replace(":", "-") + ".js")).read_text()
                    with self.subTest(reference=path.relative_to(self.skill), command=tokens[1]):
                        self.assertIn('new command_1.Command("' + tokens[1], source)
                        flags = set(re.findall(r"--[a-z][a-z-]*", source)) | {"--project", "--config"}
                        if ".option(commandUtils.FLAG_ONLY," in source:
                            common = (PACKAGE / "lib/emulator/commandUtils.js").read_text()
                            self.assertIn('exports.FLAG_ONLY = "--only <emulators>"', common)
                            flags.add("--only")
                        self.assertTrue({t.split("=")[0] for t in tokens if t.startswith("--")} <= flags)
                    count += 1
        self.assertGreater(count, 10)
        cli = (PACKAGE / "lib/index.js").read_text()
        self.assertIn("--config <path>", cli)
        self.assertIn("--project <alias_or_project_id>", cli)

    def test_deploy_creation_and_selector_hazards_match_source(self):
        prepare = (PACKAGE / "lib/deploy/firestore/prepare.js").read_text()
        config = (PACKAGE / "lib/firestore/fsConfig.js").read_text()
        create = (PACKAGE / "lib/commands/firestore-databases-create.js").read_text()
        for term in ("options.config.data.firestore", "firestoreCfg = firestoreCfg[0]",
                     "if (e.status === 404)", 'locationId: firestoreCfg.location || "nam5"',
                     "await api.createDatabase(createDatabaseReq)"):
            self.assertIn(term, prepare)
        for selector in ("rules", "indexes"):
            self.assertIn(f'if (onlyDatabases.has("{selector}"))', config)
        self.assertIn("allDatabases = true", config)
        self.assertIn("realtimeUpdatesMode = types.RealtimeUpdatesMode.ENABLED", create)
        enterprise = (self.skill / "references/enterprise/provisioning.md").read_text()
        self.assertIn('"dataAccessMode": "FIRESTORE_NATIVE"', enterprise)
        self.assertIn("defaults realtime updates to enabled", enterprise)
        for block in re.finditer(r"```bash\n(.*?)```", enterprise, re.DOTALL):
            for command in block.group(1).replace("\\\n", " ").splitlines():
                if not command.startswith("firebase firestore:databases:create "):
                    continue
                with self.subTest(command=command):
                    self.assertIn('--realtime-updates="<authorized-realtime-setting>"', command)
                    for term in ("defaults realtime updates to enabled",
                                 "`<authorized-realtime-setting>` to exactly `ENABLED` or `DISABLED`",
                                 "If the realtime choice or exact creation authorization is missing, stop before creation"):
                        self.assertIn(term, enterprise[:block.start()])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package-dir", type=Path, required=True)
    args, remaining = parser.parse_known_args()
    PACKAGE = args.package_dir.resolve(strict=True)
    unittest.main(argv=[__file__, *remaining])
