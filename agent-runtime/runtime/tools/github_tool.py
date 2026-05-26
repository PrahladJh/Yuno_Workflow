"""
GitHub tools — clone repos, browse files, read code, run shell commands.
Each agent workspace is isolated under agent-runtime/workspace/<workspace_name>/
"""
import os
import subprocess
import json
import shutil
from pathlib import Path
from langchain_core.tools import tool

WORKSPACE_ROOT = Path(__file__).parent.parent.parent / "workspace"
WORKSPACE_ROOT.mkdir(exist_ok=True)

MAX_FILE_BYTES = 50_000   # cap file reads to 50 KB
MAX_TREE_ENTRIES = 200    # cap directory listings


def _ws(name: str) -> Path:
    """Resolve a workspace directory, rejecting path traversal."""
    safe = Path(name.replace("..", "").replace("/", "_").replace("\\", "_"))
    return WORKSPACE_ROOT / safe


def _run(cmd: list, cwd: Path, timeout: int = 60) -> tuple[str, str, int]:
    """Run a subprocess, return (stdout, stderr, returncode)."""
    try:
        result = subprocess.run(
            cmd, cwd=str(cwd), capture_output=True,
            text=True, timeout=timeout
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", f"Command timed out after {timeout}s", 1
    except FileNotFoundError as e:
        return "", f"Command not found: {e}", 1


@tool
def clone_github_repo(repo_url: str, workspace_name: str) -> str:
    """
    Clone a GitHub repository into an isolated workspace.
    repo_url: full URL like https://github.com/owner/repo (or with .git)
    workspace_name: short name for the workspace folder (e.g. 'my_project')
    Returns a summary of the cloned repo structure.
    """
    ws = _ws(workspace_name)
    repo_dir = ws / "repo"

    if repo_dir.exists():
        shutil.rmtree(repo_dir)
    ws.mkdir(parents=True, exist_ok=True)

    stdout, stderr, rc = _run(
        ["git", "clone", "--depth", "1", repo_url, str(repo_dir)],
        cwd=WORKSPACE_ROOT, timeout=120
    )

    if rc != 0:
        return f"Clone failed:\n{stderr}"

    # Build a tree summary
    entries = []
    for p in sorted(repo_dir.rglob("*"))[:MAX_TREE_ENTRIES]:
        if ".git" in p.parts:
            continue
        rel = p.relative_to(repo_dir)
        prefix = "📁 " if p.is_dir() else "📄 "
        entries.append(prefix + str(rel))

    tree = "\n".join(entries[:MAX_TREE_ENTRIES])
    total = sum(1 for _ in repo_dir.rglob("*") if ".git" not in _.parts)
    return (
        f"✅ Cloned {repo_url} → workspace '{workspace_name}'\n"
        f"Total items: {total}\n\n"
        f"Structure:\n{tree}"
    )


@tool
def list_repo_files(workspace_name: str, subdirectory: str = "") -> str:
    """
    List files inside a cloned repo workspace.
    workspace_name: name used when cloning
    subdirectory: optional subfolder path relative to repo root (e.g. 'src/utils')
    """
    repo_dir = _ws(workspace_name) / "repo"
    if not repo_dir.exists():
        return f"Workspace '{workspace_name}' not found. Clone a repo first."

    target = repo_dir / subdirectory if subdirectory else repo_dir
    if not target.exists():
        return f"Directory '{subdirectory}' not found in workspace."

    entries = []
    for p in sorted(target.iterdir()):
        if p.name.startswith("."):
            continue
        size = f"  ({p.stat().st_size:,} bytes)" if p.is_file() else ""
        entries.append(("📁 " if p.is_dir() else "📄 ") + p.name + size)

    return "\n".join(entries) if entries else "Directory is empty."


@tool
def read_repo_file(workspace_name: str, file_path: str) -> str:
    """
    Read the contents of a file from a cloned repo workspace.
    workspace_name: name used when cloning
    file_path: path relative to repo root (e.g. 'src/main.py')
    Returns the file content (truncated at 50 KB).
    """
    repo_dir = _ws(workspace_name) / "repo"
    if not repo_dir.exists():
        return f"Workspace '{workspace_name}' not found. Clone a repo first."

    target = repo_dir / file_path.lstrip("/")
    if not target.exists():
        return f"File '{file_path}' not found."
    if not target.is_file():
        return f"'{file_path}' is a directory, not a file."

    try:
        content = target.read_bytes()
        if len(content) > MAX_FILE_BYTES:
            text = content[:MAX_FILE_BYTES].decode("utf-8", errors="replace")
            return text + f"\n\n[... truncated — file is {len(content):,} bytes total]"
        return content.decode("utf-8", errors="replace")
    except Exception as e:
        return f"Error reading file: {e}"


@tool
def run_shell_in_workspace(workspace_name: str, command: str) -> str:
    """
    Run a shell command inside a cloned repo workspace.
    workspace_name: name used when cloning
    command: shell command to run (e.g. 'python main.py', 'pip install -r requirements.txt')
    Returns stdout + stderr output with exit code.
    CAUTION: runs with the permissions of the agent-runtime process.
    """
    repo_dir = _ws(workspace_name) / "repo"
    if not repo_dir.exists():
        return f"Workspace '{workspace_name}' not found. Clone a repo first."

    # Use the workspace's venv python if available
    venv_python = _ws(workspace_name) / "venv" / ("Scripts" if os.name == "nt" else "bin") / "python"
    if command.startswith("python ") and venv_python.exists():
        command = str(venv_python) + command[6:]

    stdout, stderr, rc = _run(
        command.split() if " " in command else [command],
        cwd=repo_dir, timeout=60
    )
    parts = []
    if stdout:
        parts.append(f"STDOUT:\n{stdout.strip()}")
    if stderr:
        parts.append(f"STDERR:\n{stderr.strip()}")
    parts.append(f"Exit code: {rc}")
    return "\n\n".join(parts)
