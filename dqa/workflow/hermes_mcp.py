"""Hermes stdio adapter for the local DQA workflow."""
import asyncio
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
from uuid import uuid4

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

DQA = Path(__file__).resolve().parents[1]
REGISTRY = Path(os.environ["DQA_PROJECT_REGISTRY"]).resolve(strict=True)
NODE = shutil.which("node")
if not NODE:
    raise RuntimeError("Node.js must be on the MCP server PATH")

MODES = ("inspect", "rules", "model", "hybrid")


def config() -> dict:
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def dqa_projects() -> list[str]:
    """List DQA project IDs registered by the local operator."""
    return sorted(config())


def dqa_start(
    project: str,
    mode: str = "hybrid",
) -> dict:
    """Start a local check or repair for a registered project. Returns a run ID."""
    if mode not in MODES:
        raise ValueError("Unknown repair mode")
    profile = config().get(project)
    if not isinstance(profile, str):
        raise ValueError("Unknown project ID")
    profile = (REGISTRY.parent / profile).resolve(strict=True)
    run_id = "repair-" + str(uuid4())
    run = DQA / "runs" / run_id
    run.mkdir(parents=True, exist_ok=False)
    env = {key: os.environ[key] for key in ("PATH", "HOME", "LANG", "TMPDIR", "DQA_CHROME", "DQA_DESIGNS_DIR") if key in os.environ}
    with (run / "launcher.log").open("wb") as log:
        child = subprocess.Popen(
            [NODE, str(DQA / "cli.js"), "local-repair", "--profile", str(profile), "--mode", mode, "--run-id", run_id],
            cwd=DQA, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True,
        )
    threading.Thread(target=child.wait, daemon=True).start()
    (run / "mcp-launch.json").write_text(json.dumps({"pid": child.pid, "project": project}), encoding="utf-8")
    return {"run_id": run_id, "state": "queued", "project": project}


def dqa_status(run_id: str) -> dict:
    """Read status and verification counts for a local DQA repair run."""
    if not re.fullmatch(r"repair-[a-f0-9-]{36}", run_id):
        raise ValueError("Invalid run ID")
    run = DQA / "runs" / run_id
    job_file = run / "local-repair.json"
    if not job_file.is_file():
        launch = json.loads((run / "mcp-launch.json").read_text(encoding="utf-8"))
        try:
            os.kill(launch["pid"], 0)
        except ProcessLookupError:
            return {"run_id": run_id, "state": "failed", "error": "DQA did not start. Check launcher.log locally."}
        return {"run_id": run_id, "state": "queued"}
    completed = subprocess.run(
        [NODE, str(DQA / "cli.js"), "repair-status", "--run", run_id],
        cwd=DQA, capture_output=True, text=True, check=True, timeout=10,
    )
    job = json.loads(completed.stdout)
    # Keep paths, source, screenshots and fixture bodies on disk.
    keys = ("run_id", "state", "mode", "before", "fixed", "candidate_fixed", "regressions", "journeys", "model", "model_repairs", "rule_repairs", "last", "artifacts")
    result = {key: job[key] for key in keys if key in job}
    if job.get("error"):
        result["error"] = "Check local-repair.json and launcher.log locally."
    return result


FUNCTIONS = {f.__name__: f for f in (dqa_projects, dqa_start, dqa_status)}
INPUTS = {
    "dqa_projects": {"properties": {}},
    "dqa_start": {
        "properties": {"project": {"type": "string"}, "mode": {"type": "string", "enum": MODES}},
        "required": ["project"],
    },
    "dqa_status": {"properties": {"run_id": {"type": "string"}}, "required": ["run_id"]},
}


async def list_tools(_context, _params):
    return types.ListToolsResult(tools=[
        types.Tool(
            name=name, description=fn.__doc__,
            inputSchema={"type": "object", "additionalProperties": False, **INPUTS[name]},
        )
        for name, fn in FUNCTIONS.items()
    ])


async def call_tool(_context, params):
    try:
        fn = FUNCTIONS.get(params.name)
        if fn is None:
            raise ValueError("Unknown DQA tool")
        output = await asyncio.to_thread(fn, **(params.arguments or {}))
        data = {"projects": output} if isinstance(output, list) else output
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=json.dumps(data, ensure_ascii=False))],
            structuredContent=data,
        )
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        return types.CallToolResult(
            isError=True,
            content=[types.TextContent(type="text", text="DQA could not complete the tool call. Check the project ID or run ID.")],
        )


async def main():
    server = Server("dqa-local", version="0.1", on_list_tools=list_tools, on_call_tool=call_tool)
    async with stdio_server() as (reader, writer):
        await server.run(reader, writer, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
