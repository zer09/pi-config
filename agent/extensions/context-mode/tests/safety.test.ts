import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getCommandDenyReason, getPathDenyReason, getWorkingDirectoryDenyReason } from "../src/safety.js";

describe("batch command safety", () => {
  const blocked = [
    "rm -rf .",
    "r\\m -rf .",
    "rm -r /tmp/x",
    "rm -R /tmp/x",
    "rm --recursive /tmp/x",
    "rm -r -f /tmp/x",
    "rm -R -f /tmp/x",
    "rm -r --force /tmp/x",
    "rm --force -r /tmp/x",
    "rm \"-rf\" /tmp/x",
    "rm '-rf' /tmp/x",
    "rm -\"rf\" /tmp/x",
    "`rm -rf /tmp/x`",
    "echo `rm -rf /tmp/x`",
    "`git push`",
    "git push",
    "g\\it pus\\h origin main",
    "g\\\nit push origin main",
    "git \"push\" origin main",
    "git pu\"sh\" origin main",
    "rtk git push",
    "git reset --hard HEAD",
    "git clean -fd",
    "gh api -X POST /repos/o/r/issues",
    "g\\h pr mer\\ge 1",
    "chmod --recursive 777 /tmp/x",
    "chown --recursive root /tmp/x",
    "kubectl delete pod foo",
    "terraform destroy -auto-approve",
    "npm publish",
    "bash <<EOF\nrm -rf /tmp/x\nEOF",
    "eval \"rm -rf /tmp/x\"",
    "e\\val \"rm -rf /tmp/x\"",
    "bash -c \"rm -rf /tmp/x\"",
    "b\\ash -c \"rm -rf /tmp/x\"",
    "echo SECRET > .env",
    "echo SECRET > .e\\nv",
    "echo SECRET > .git/config",
    "echo SECRET > .g\\it/config",
    "echo KEY > secret.pem",
    "echo KEY > secret.p\\em",
    "FOO=bar rtk rm \"-rf\" /tmp/x",
    "git -C repo push",
    "gh --repo o/r issue edit 1",
    "kubectl --context prod delete pod foo",
    "terraform -chdir=prod destroy",
    "firebase --project prod deploy",
    "docker --context prod push image",
    "npm --workspace pkg publish",
    "yarn --cwd pkg publish",
    "yarn npm publish",
    "pnpm -C pkg publish",
    "pnpm --dir pkg publish",
    "npx semantic-release",
    "npm exec semantic-release",
    "npx vercel deploy",
    "pnpm dlx firebase deploy",
    "npx changeset publish",
    "rtk git -C repo push",
    "sudo rm -rf /",
    "sudo git push",
    "sudo kubectl delete pod foo",
    "sudo terraform apply",
    "nohup rm -r /",
    "time rm -rf /",
    "nice rm -rf /",
    "env FOO=bar rm -rf /",
    "echo \"rm -rf /\" | sh",
    "echo git push | bash",
    "echo evil | s\\h",
    "echo evil | b\\ash",
    "echo evil | ba\"\"sh",
    "echo hi | \"sh\"",
    "echo hi | 'sh'",
    "echo hi | \"b\"ash",
    "echo hi | 'b'ash",
    "echo hi | b\"a\"sh",
    "find . -print0 | xargs -0 rm -rf",
    "xargs --null rm -rf",
    "sudo bash -c \"rm -rf /\"",
    "sudo bash <<EOF\nrm -rf /tmp/x\nEOF",
    "mv /etc /tmp/x",
    "mv .. /tmp/x",
    "mv -t /tmp /home/gc",
  ];

  for (const command of blocked) {
    it(`blocks ${command}`, () => {
      expect(getCommandDenyReason(command)).toBeTruthy();
    });
  }

  const allowed = [
    "git status --short",
    "rtk git status --short",
    "npm test",
    "pytest",
    "cargo test",
    "npm run lint",
    "npm run build",
    "tsc --noEmit",
    "gh issue view 123",
    "echo g\\it pus\\h origin main",
    "gh pr list --state open",
    "rg TODO src",
    "rm --verbose file",
    "rm --interactive file",
    "rm --dir foo",
    "rm --file file",
    "rm --one-file-system /",
    "rm --no-preserve-root /",
    "rm -- --force",
    "chmod --verbose 644 f",
    "chown --from=x root f",
    "rg \"git push\" src/",
    "grep \"rm -rf\" logs/",
    "rg \"kubectl delete\" .",
    "rg foo\\; git push",
    "echo ok \\; git push",
    "rg foo\\| sh",
    "echo \\> .env",
    "jq \".[]|select(.c==\\\"git push\\\")\" log.json",
    "echo git push",
    "grep \"| sh\" docs/file.md",
    "echo \"| sh\"",
    "sudo git status --short",
    "sudo rg \"git push\" src/",
    "env FOO=bar git status",
    "command -v git push",
    "xargs echo rm -rf",
    "npx echo git push",
    "npm exec echo git push",
    "pnpm dlx echo rm -rf",
    "yarn dlx echo semantic-release",
    "mv file /tmp",
    "mv file .",
    "mv ./x ./y",
    "mv -i f /tmp",
  ];

  for (const command of allowed) {
    it(`allows ${command}`, () => {
      expect(getCommandDenyReason(command)).toBeNull();
    });
  }
});

describe("ctx_execute_file path safety", () => {
  it("blocks obvious secrets and keys", () => {
    expect(getPathDenyReason("/work/project/.env")).toMatch(/env/);
    expect(getPathDenyReason("/work/project/.env.local")).toMatch(/env/);
    expect(getPathDenyReason("/home/gc/.ssh/id_rsa")).toMatch(/credential|key/);
    expect(getPathDenyReason("/work/project/key.pem")).toMatch(/key/);
    expect(getPathDenyReason("/work/project/.git/config")).toMatch(/git/);
  });

  it("blocks common credential config files", () => {
    expect(getPathDenyReason("/home/gc/.aws/credentials", { home: "/home/gc" })).toMatch(/credential/);
    expect(getPathDenyReason("/home/gc/.config/gh/hosts.yml", { home: "/home/gc" })).toMatch(/credential/);
  });

  it("blocks symlinks to sensitive targets", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-lean-safety-"));
    try {
      const envPath = join(dir, ".env");
      const linkPath = join(dir, "config-link");
      writeFileSync(envPath, "SECRET=1\n", "utf8");
      symlinkSync(envPath, linkPath);
      expect(getPathDenyReason(linkPath)).toMatch(/env/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks sensitive working directories", () => {
    expect(getWorkingDirectoryDenyReason("/work/project/.git")).toMatch(/sensitive/);
    expect(getWorkingDirectoryDenyReason("/home/gc/.ssh", { home: "/home/gc" })).toMatch(/sensitive/);
    expect(getWorkingDirectoryDenyReason("/home/gc/.aws", { home: "/home/gc" })).toMatch(/sensitive/);
  });

  it("allows ordinary project data files", () => {
    expect(getPathDenyReason("/work/project/coverage/coverage-final.json")).toBeNull();
    expect(getPathDenyReason("/work/project/logs/test.log")).toBeNull();
  });
});
