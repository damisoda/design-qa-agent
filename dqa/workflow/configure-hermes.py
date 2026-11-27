"""Create a dedicated on-disk Hermes profile for local DQA."""
import argparse
from importlib.metadata import PackageNotFoundError, version
import json
from pathlib import Path
import re
import sys

DQA = Path(__file__).resolve().parents[1]
cli = argparse.ArgumentParser()
cli.add_argument("--registry", type=Path, default=DQA / "workflow" / "hermes-projects.json")
cli.add_argument("--model", default="qwen3.5:4b")
args = cli.parse_args()
try:
    sdk_version = version("mcp")
except PackageNotFoundError:
    sdk_version = ""
if not sdk_version.startswith("2."):
    cli.error("Use the Python interpreter with MCP SDK 2.x installed")
if not re.fullmatch(r"[\w][\w./:-]{0,100}", args.model) or re.search(r"(?:^|[-:/])cloud(?:$|[-:/])", args.model):
    cli.error("Choose a local Ollama model")
registry = args.registry.resolve(strict=True)
profile = DQA / "state" / "hermes-dqa"
profile.mkdir(parents=True, exist_ok=True)
config = {
    "model": {
        "provider": "custom",
        "base_url": "http://127.0.0.1:11434/v1",
        "default": args.model,
        "context_length": 65536,
    },
    "agent": {"run_budget_seconds": 120},
    "mcp_servers": {
        "dqa": {
            "command": sys.executable,
            "args": [str(DQA / "workflow" / "hermes_mcp.py")],
            "env": {"DQA_PROJECT_REGISTRY": str(registry)},
            "tools": {"include": ["dqa_projects", "dqa_start", "dqa_status"], "resources": False, "prompts": False},
        },
    },
}
# JSON is valid YAML. Creating a new file prevents clobbering an existing profile.
file = profile / "config.yaml"
with file.open("x", encoding="utf-8") as stream:
    json.dump(config, stream, indent=2)
    stream.write("\n")
print(profile)
