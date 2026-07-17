#!/usr/bin/env python3
"""Generate a dependency-free, symlink-safe review UI for skill eval outputs."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import random
import stat
import tempfile
import webbrowser
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from eval_utils import atomic_write_text

TEXT_EXTENSIONS = {
    ".txt",
    ".md",
    ".json",
    ".csv",
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".sh",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".sql",
    ".toml",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}


def has_symlink_component(path: Path) -> bool:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            return True
    return False


def load_regular_json(path: Path) -> dict[str, Any] | None:
    if path.is_symlink():
        return None
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            return None
        value = json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None
    return value if isinstance(value, dict) else None


def safe_output_files(
    outputs_dir: Path, max_file_bytes: int, budget: list[int]
) -> list[dict[str, Any]]:
    if outputs_dir.is_symlink() or not outputs_dir.is_dir():
        return []
    root_resolved = outputs_dir.resolve()
    embedded = []
    for root, directories, files in os.walk(outputs_dir, followlinks=False):
        root_path = Path(root)
        safe_directories = []
        for name in sorted(directories):
            child = root_path / name
            if child.is_symlink():
                embedded.append(
                    {
                        "name": str(child.relative_to(outputs_dir)),
                        "type": "omitted",
                        "size": 0,
                        "message": "Symlinked directory omitted",
                    }
                )
            else:
                safe_directories.append(name)
        directories[:] = safe_directories
        for name in sorted(files):
            path = root_path / name
            relative_name = str(path.relative_to(outputs_dir))
            if path.is_symlink():
                embedded.append(
                    {
                        "name": relative_name,
                        "type": "omitted",
                        "size": 0,
                        "message": "Symlinked file omitted",
                    }
                )
                continue
            try:
                mode = path.lstat().st_mode
                resolved = path.resolve(strict=True)
                resolved.relative_to(root_resolved)
            except (OSError, ValueError):
                embedded.append(
                    {
                        "name": relative_name,
                        "type": "omitted",
                        "size": 0,
                        "message": "Unsafe output path omitted",
                    }
                )
                continue
            if not stat.S_ISREG(mode):
                embedded.append(
                    {
                        "name": relative_name,
                        "type": "omitted",
                        "size": 0,
                        "message": "Non-regular output omitted",
                    }
                )
                continue
            size = path.stat().st_size
            if size > max_file_bytes or size > budget[0]:
                embedded.append(
                    {
                        "name": relative_name,
                        "type": "omitted",
                        "size": size,
                        "message": "File exceeds viewer embedding limits; inspect it locally.",
                    }
                )
                continue
            suffix = path.suffix.lower()
            if suffix in TEXT_EXTENSIONS:
                item = {
                    "name": relative_name,
                    "type": "text",
                    "size": size,
                    "content": path.read_text(errors="replace"),
                }
            else:
                raw = path.read_bytes()
                mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                if suffix in IMAGE_EXTENSIONS:
                    kind = "image"
                elif suffix == ".pdf":
                    kind = "pdf"
                else:
                    kind = "binary"
                item = {
                    "name": relative_name,
                    "type": kind,
                    "size": size,
                    "mime": mime,
                    "data_uri": f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}",
                }
            embedded.append(item)
            budget[0] -= size
    return embedded


def load_workspace_runs(
    workspace: Path, max_file_bytes: int, max_total_bytes: int
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = load_regular_json(workspace / "manifest.json")
    if not manifest or not isinstance(manifest.get("expected_jobs"), list):
        raise ValueError("A valid manifest.json with expected_jobs is required")
    budget = [max_total_bytes]
    runs = []
    for job in manifest["expected_jobs"]:
        if not isinstance(job, dict):
            continue
        relative = Path(str(job.get("relative_run_path", "")))
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Unsafe run path in manifest: {relative}")
        run_dir = workspace / relative
        current = workspace
        for part in relative.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError(f"Run path contains a symlink: {relative}")
        try:
            run_dir.resolve().relative_to(workspace)
        except ValueError as exc:
            raise ValueError(f"Run path escapes workspace: {relative}") from exc
        eval_dir = workspace / relative.parts[0]
        metadata = load_regular_json(eval_dir / "eval_metadata.json") or {}
        review_id = job.get("review_id")
        if not isinstance(review_id, str) or not review_id.startswith("review-"):
            raise ValueError("Each expected job requires an opaque review_id")
        runs.append(
            {
                "id": review_id,
                "eval_id": job.get("eval_id"),
                "eval_name": job.get(
                    "eval_name", metadata.get("eval_name", eval_dir.name)
                ),
                "prompt": metadata.get("prompt", "(No prompt found)"),
                "expected_output": metadata.get("expected_output", ""),
                "configuration": job.get("configuration"),
                "run_number": job.get("run_number"),
                "outputs": safe_output_files(
                    run_dir / "outputs", max_file_bytes, budget
                ),
                "grading": load_regular_json(run_dir / "grading.json"),
                "run": load_regular_json(run_dir / "run.json"),
                "_key": [
                    str(job.get("eval_id")),
                    str(job.get("configuration")),
                    int(job.get("run_number", 0)),
                ],
            }
        )
    return manifest, runs


def previous_context(
    workspace: Path | None, max_file_bytes: int, max_total_bytes: int
) -> tuple[dict[tuple[str, str, int], dict[str, Any]], dict[str, Any] | None]:
    if not workspace:
        return {}, None
    manifest, runs = load_workspace_runs(workspace, max_file_bytes, max_total_bytes)
    feedback_data = load_regular_json(workspace / "feedback.json") or {}
    feedback_by_id = {
        item.get("run_id"): item.get("feedback", "")
        for item in feedback_data.get("reviews", [])
        if isinstance(item, dict) and isinstance(item.get("run_id"), str)
    }
    return (
        {
            tuple(run["_key"]): {
                "outputs": run["outputs"],
                "feedback": feedback_by_id.get(run["id"], ""),
            }
            for run in runs
        },
        manifest,
    )


def blind_benchmark(
    benchmark: dict[str, Any], labels: dict[str, str]
) -> dict[str, Any]:
    value = json.loads(json.dumps(benchmark))
    metadata = value.get("metadata", {})
    metadata["configurations"] = sorted(labels.values())
    metadata.pop("primary_configuration", None)
    metadata.pop("baseline_configuration", None)
    summary = value.get("run_summary", {})
    config_summary = {
        labels.get(key, "Configuration"): item
        for key, item in summary.items()
        if key != "delta"
    }
    transformed_summary = {key: config_summary[key] for key in sorted(config_summary)}
    if "delta" in summary:
        summary["delta"]["definition"] = "matched signed configuration difference"
        transformed_summary["delta"] = summary["delta"]
    value["run_summary"] = transformed_summary
    for run in value.get("runs", []):
        run["configuration"] = labels.get(run.get("configuration"), "Configuration")
        run.pop("run_path", None)
    for failure in value.get("critical_failures", []):
        failure["configuration"] = labels.get(
            failure.get("configuration"), "Configuration"
        )
    return value


def scrub_blind_strings(value: Any, forbidden: list[str]) -> Any:
    if isinstance(value, str):
        for token in forbidden:
            value = value.replace(token, "[configuration]")
        return value
    if isinstance(value, list):
        return [scrub_blind_strings(item, forbidden) for item in value]
    if isinstance(value, dict):
        return {
            key: scrub_blind_strings(item, forbidden) for key, item in value.items()
        }
    return value


def safe_json_for_html(value: Any) -> str:
    return (
        json.dumps(value, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def generate_html(data: dict[str, Any]) -> str:
    embedded = safe_json_for_html(data)
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skill evaluation review</title><style>
:root{{--bg:#f6f5f1;--card:#fff;--text:#1b1b19;--muted:#67665f;--border:#d9d7cf;--good:#267247;--bad:#ad3434}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}}header{{position:sticky;top:0;background:#20201e;color:#fff;padding:14px 20px;display:flex;gap:16px;align-items:center;z-index:2}}header h1{{font-size:17px;margin:0;flex:1}}button{{border:1px solid var(--border);border-radius:7px;background:#fff;padding:8px 12px;cursor:pointer}}main{{max-width:1100px;margin:20px auto;padding:0 16px}}.card{{background:var(--card);border:1px solid var(--border);border-radius:10px;margin:14px 0;padding:16px}}.label{{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}}.meta{{display:flex;gap:10px;flex-wrap:wrap;color:var(--muted)}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f2ed;padding:12px;border-radius:7px;max-height:520px;overflow:auto}}img{{max-width:100%;height:auto}}iframe{{width:100%;height:650px;border:1px solid var(--border)}}textarea{{width:100%;min-height:110px;padding:10px}}.file{{border-top:1px solid var(--border);padding-top:12px;margin-top:12px}}.pass{{color:var(--good)}}.fail{{color:var(--bad)}}.hidden{{display:none}}nav{{display:flex;gap:8px;align-items:center}}#progress{{min-width:90px;text-align:center}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid var(--border);padding:8px;text-align:left}}.blocker{{border:2px solid var(--bad);color:var(--bad);font-weight:700}}
</style></head><body>
<header><h1 id="title">Skill evaluation review</h1><nav><button id="prev">Previous</button><span id="progress"></span><button id="next">Next</button><button id="submit">Submit reviews</button></nav></header>
<main><section id="critical" class="card blocker hidden"></section><section id="empty" class="card hidden">No runs found.</section><section id="run-panel">
<div class="card"><div class="meta"><strong id="eval-name"></strong><span id="config"></span><span id="status"></span></div><div class="label">Prompt</div><pre id="prompt"></pre><div id="expected-wrap"><div class="label">Expected output</div><p id="expected"></p></div></div>
<div class="card"><div class="label">Outputs</div><div id="outputs"></div></div><div class="card hidden" id="previous-card"><div class="label">Previous iteration outputs</div><div id="previous-outputs"></div></div>
<div class="card" id="grades-card"><div class="label">Formal grades</div><div id="grades"></div></div><div class="card"><div class="label">Feedback</div><textarea id="feedback" placeholder="What should improve? Leave empty if acceptable."></textarea><p id="previous-feedback"></p></div></section><section id="benchmark" class="card"></section></main>
<script id="eval-data" type="application/json">{embedded}</script><script>
const DATA=JSON.parse(document.getElementById('eval-data').textContent),runs=DATA.runs||[],feedback={{}};let index=0;const $=id=>document.getElementById(id);
function save(){{if(runs.length)feedback[runs[index].id]=$('feedback').value}}function fileNode(f){{const w=document.createElement('div');w.className='file';const h=document.createElement('strong');h.textContent=f.name+' ('+f.size+' bytes)';w.appendChild(h);if(f.type==='text'){{const p=document.createElement('pre');p.textContent=f.content;w.appendChild(p)}}else if(f.type==='image'){{const i=document.createElement('img');i.src=f.data_uri;i.alt=f.name;w.appendChild(i)}}else if(f.type==='pdf'){{const i=document.createElement('iframe');i.src=f.data_uri;w.appendChild(i)}}else if(f.type==='binary'){{const a=document.createElement('a');a.href=f.data_uri;a.download=f.name;a.textContent='Download file';w.appendChild(document.createElement('br'));w.appendChild(a)}}else{{const p=document.createElement('p');p.textContent=f.message||'Not embedded';w.appendChild(p)}}return w}}
function files(root,items){{root.replaceChildren();if(!items.length)root.textContent='No output files';else for(const f of items)root.appendChild(fileNode(f))}}function grades(g){{const root=$('grades');root.replaceChildren();$('grades-card').classList.toggle('hidden',!g);if(!g)return;for(const e of g.expectations||[]){{const p=document.createElement('p');p.className=e.passed?'pass':'fail';p.textContent=(e.passed?'✓ ':'✗ ')+e.text+(e.critical?' [critical]':'');root.appendChild(p);if(e.evidence){{const q=document.createElement('pre');q.textContent=e.evidence;root.appendChild(q)}}}}}}
function show(i){{if(!runs.length){{$('empty').classList.remove('hidden');$('run-panel').classList.add('hidden');return}}save();index=Math.max(0,Math.min(i,runs.length-1));const r=runs[index];$('eval-name').textContent=r.eval_name;$('config').textContent=r.configuration;$('status').textContent=(r.run&&r.run.status)||'unknown';$('prompt').textContent=r.prompt;$('expected').textContent=r.expected_output||'';$('expected-wrap').classList.toggle('hidden',!r.expected_output);files($('outputs'),r.outputs||[]);files($('previous-outputs'),r.previous_outputs||[]);$('previous-card').classList.toggle('hidden',!(r.previous_outputs||[]).length);grades(r.grading);$('feedback').value=feedback[r.id]??'';$('previous-feedback').textContent=r.previous_feedback?'Previous feedback: '+r.previous_feedback:'';$('progress').textContent=`${{index+1}} / ${{runs.length}}`;$('prev').disabled=index===0;$('next').disabled=index===runs.length-1}}
function benchmark(){{const b=DATA.benchmark,root=$('benchmark');if(!b){{root.classList.add('hidden');return}}const failures=b.critical_failures||[];if(failures.length){{const c=$('critical');c.classList.remove('hidden');c.textContent=`STOP: ${{failures.length}} run(s) contain critical assertion failures.`}}const h=document.createElement('h2');h.textContent='Benchmark';root.appendChild(h);const table=document.createElement('table'),head=document.createElement('tr');for(const n of ['Configuration','Expected','Completed','Graded','Pass rate','Time','Tokens','Critical failures']){{const th=document.createElement('th');th.textContent=n;head.appendChild(th)}}table.appendChild(head);for(const config of b.metadata.configurations||[]){{const s=b.run_summary[config]||{{}},tr=document.createElement('tr'),vals=[config,s.expected_runs??'—',s.completed_runs??'—',s.graded_runs??'—',s.pass_rate?Math.round(s.pass_rate.mean*100)+'%':'—',s.time_seconds?s.time_seconds.mean.toFixed(1)+'s':'—',s.tokens?Math.round(s.tokens.mean):'—',s.critical_failures??0];for(const v of vals){{const td=document.createElement('td');td.textContent=v;tr.appendChild(td)}}table.appendChild(tr)}}root.appendChild(table)}}
function payload(){{save();const now=new Date().toISOString();return{{reviews:runs.map(r=>({{run_id:r.id,feedback:feedback[r.id]||'',timestamp:now}})),status:'complete'}}}}async function submit(){{const data=payload();try{{const r=await fetch('/api/feedback',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(data)}});if(!r.ok)throw new Error();alert('Feedback saved.')}}catch{{const b=new Blob([JSON.stringify(data,null,2)],{{type:'application/json'}}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='feedback.json';a.click();URL.revokeObjectURL(a.href)}}}}
$('prev').onclick=()=>show(index-1);$('next').onclick=()=>show(index+1);$('submit').onclick=submit;$('feedback').oninput=()=>{{if(runs.length)feedback[runs[index].id]=$('feedback').value}};document.onkeydown=e=>{{if(e.target.tagName==='TEXTAREA')return;if(e.key==='ArrowLeft')show(index-1);if(e.key==='ArrowRight')show(index+1)}};$('title').textContent=(DATA.skill_name||'Skill')+' evaluation review';benchmark();show(0);
</script></body></html>"""


def atomic_write_feedback(path: Path, data: dict[str, Any]) -> None:
    if path.is_symlink():
        raise ValueError("feedback.json cannot be a symlink")
    if path.exists() and not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("feedback.json must be a regular file")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=".feedback-", suffix=".tmp", dir=path.parent
    )
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


class ReviewHandler(BaseHTTPRequestHandler):
    def __init__(
        self,
        html: str,
        feedback_path: Path,
        allowed_run_ids: set[str],
        *args: Any,
        **kwargs: Any,
    ):
        self.html = html
        self.feedback_path = feedback_path
        self.allowed_run_ids = allowed_run_ids
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        if self.path not in ("/", "/index.html"):
            self.send_error(404)
            return
        body = self.html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/api/feedback":
            self.send_error(404)
            return
        origin = self.headers.get("Origin")
        allowed = {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }
        if origin and origin not in allowed:
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            self.send_error(413)
            return
        try:
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict) or not isinstance(data.get("reviews"), list):
                raise ValueError("Expected reviews array")
            seen_ids = set()
            for review in data["reviews"]:
                if not isinstance(review, dict):
                    raise ValueError("Each review must be an object")
                run_id = review.get("run_id")
                if run_id not in self.allowed_run_ids or run_id in seen_ids:
                    raise ValueError("Unknown or duplicate review run_id")
                if not isinstance(review.get("feedback"), str):
                    raise ValueError("Review feedback must be a string")
                seen_ids.add(run_id)
            atomic_write_feedback(self.feedback_path, data)
        except (json.JSONDecodeError, OSError, ValueError) as exc:
            self.send_error(400, str(exc))
            return
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a local skill-evaluation review UI"
    )
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--benchmark", type=Path)
    parser.add_argument("--previous-workspace", type=Path)
    parser.add_argument("--skill-name")
    parser.add_argument("--blind", action="store_true")
    parser.add_argument("--blind-seed", type=int)
    parser.add_argument("--static", type=Path)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--max-file-mb", type=int, default=5)
    parser.add_argument("--max-total-mb", type=int, default=25)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    lexical = Path(os.path.abspath(args.workspace.expanduser()))
    if has_symlink_component(lexical) or not lexical.is_dir():
        parser.error(f"Workspace must not contain symlink components: {lexical}")
    workspace = lexical.resolve()
    max_file = args.max_file_mb * 1024 * 1024
    max_total = args.max_total_mb * 1024 * 1024
    try:
        manifest, runs = load_workspace_runs(workspace, max_file, max_total)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))

    previous_path = (
        args.previous_workspace.expanduser().resolve()
        if args.previous_workspace
        else None
    )
    try:
        old, previous_manifest = previous_context(previous_path, max_file, max_total)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    for run in runs:
        context = old.get(tuple(run["_key"]), {})
        run["previous_outputs"] = context.get("outputs", [])
        run["previous_feedback"] = context.get("feedback", "")
        run.pop("_key", None)

    benchmark_path = (
        args.benchmark.expanduser().resolve()
        if args.benchmark
        else workspace / "benchmark.json"
    )
    benchmark = load_regular_json(benchmark_path)
    if args.blind:
        configs = list(manifest.get("configurations", []))
        rng = (
            random.Random(args.blind_seed)
            if args.blind_seed is not None
            else random.SystemRandom()
        )
        rng.shuffle(configs)
        labels = {
            config: f"Configuration {chr(65 + index)}"
            for index, config in enumerate(configs)
        }
        for run in runs:
            run["configuration"] = labels.get(run["configuration"], "Configuration")
            if isinstance(run.get("run"), dict):
                run["run"].pop("configuration", None)
                run["run"].pop("command", None)
                run["run"].pop("inputs", None)
        if benchmark:
            benchmark = blind_benchmark(benchmark, labels)
        manifests = [manifest]
        if previous_manifest:
            manifests.append(previous_manifest)
        forbidden = [
            "mandatory_skill",
            "mandatory skill",
            "evaluation_context",
            "evaluation context",
            "Use the following evaluation context as system guidance.",
            "Apply these instructions for the task.",
            "No additional skill instructions apply to this task.",
        ]
        for source_manifest in manifests:
            forbidden.extend(source_manifest.get("configurations", []))
            forbidden.extend(source_manifest.get("arm_mapping", {}).values())
            forbidden.extend(
                [
                    str(source_manifest.get("skill_path") or ""),
                    str(source_manifest.get("baseline_skill_path") or ""),
                ]
            )
        forbidden = [token for token in forbidden if token]
        runs = scrub_blind_strings(runs, forbidden)
        if benchmark:
            benchmark = scrub_blind_strings(benchmark, forbidden)

    data = {
        "skill_name": args.skill_name or manifest.get("skill_name", workspace.name),
        "runs": runs,
        "benchmark": benchmark,
    }
    html = generate_html(data)
    if args.static:
        try:
            output = atomic_write_text(args.static, html, create_parents=True)
        except (ValueError, OSError) as exc:
            parser.error(str(exc))
        print(f"Static viewer written to: {output}")
        return

    handler = partial(
        ReviewHandler,
        html,
        workspace / "feedback.json",
        {run["id"] for run in runs},
    )
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Viewer: {url}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
