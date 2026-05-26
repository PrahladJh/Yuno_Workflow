"""
Sandbox executor tools — create isolated Python environments, run code, see errors.
Each sandbox lives in agent-runtime/workspace/<workspace_name>/venv/
"""
import os
import sys
import subprocess
import tempfile
import json
from pathlib import Path
from langchain_core.tools import tool

WORKSPACE_ROOT = Path(__file__).parent.parent.parent / "workspace"
WORKSPACE_ROOT.mkdir(exist_ok=True)

EXEC_TIMEOUT = 30   # seconds per code run
INSTALL_TIMEOUT = 120


def _ws(name: str) -> Path:
    safe = name.replace("..", "").replace("/", "_").replace("\\", "_")
    return WORKSPACE_ROOT / safe


def _python_bin(workspace_name: str) -> str:
    """Return the Python executable for this sandbox (venv or system)."""
    venv = _ws(workspace_name) / "venv"
    if os.name == "nt":
        candidate = venv / "Scripts" / "python.exe"
    else:
        candidate = venv / "bin" / "python"
    return str(candidate) if candidate.exists() else sys.executable


@tool
def create_python_sandbox(workspace_name: str, packages: str = "") -> str:
    """
    Create an isolated Python virtual environment for a workspace.
    workspace_name: short name for the sandbox (e.g. 'data_analysis')
    packages: space-separated list of pip packages to pre-install
              (e.g. 'pandas numpy matplotlib requests')
    Returns creation status and installed packages.
    """
    ws = _ws(workspace_name)
    venv_dir = ws / "venv"
    ws.mkdir(parents=True, exist_ok=True)

    # Create venv
    result = subprocess.run(
        [sys.executable, "-m", "venv", str(venv_dir)],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        return f"Failed to create venv:\n{result.stderr}"

    report = [f"✅ Sandbox '{workspace_name}' created at {venv_dir}"]

    # Install packages if requested
    if packages.strip():
        pkg_list = packages.strip().split()
        pip = str(venv_dir / ("Scripts" if os.name == "nt" else "bin") / "pip")
        install_result = subprocess.run(
            [pip, "install", "--quiet"] + pkg_list,
            capture_output=True, text=True, timeout=INSTALL_TIMEOUT
        )
        if install_result.returncode == 0:
            report.append(f"📦 Installed: {', '.join(pkg_list)}")
        else:
            report.append(f"⚠️ Package install issues:\n{install_result.stderr[:500]}")

    return "\n".join(report)


@tool
def install_packages_in_sandbox(workspace_name: str, packages: str) -> str:
    """
    Install additional pip packages into an existing sandbox.
    workspace_name: name of an existing sandbox
    packages: space-separated list of packages (e.g. 'scikit-learn torch')
    """
    ws = _ws(workspace_name)
    pip_path = ws / "venv" / ("Scripts" if os.name == "nt" else "bin") / "pip"

    if not pip_path.exists():
        return f"Sandbox '{workspace_name}' not found. Create it first with create_python_sandbox."

    pkg_list = packages.strip().split()
    result = subprocess.run(
        [str(pip_path), "install"] + pkg_list,
        capture_output=True, text=True, timeout=INSTALL_TIMEOUT
    )

    if result.returncode == 0:
        return f"✅ Installed: {', '.join(pkg_list)}\n{result.stdout[-300:].strip()}"
    return f"Install failed:\n{result.stderr[-500:]}"


@tool
def run_python_code_in_sandbox(workspace_name: str, code: str) -> str:
    """
    Execute Python code inside an isolated sandbox environment.
    workspace_name: name of the sandbox (created with create_python_sandbox)
    code: Python code to execute. Has access to all installed packages.
          Use print() to see output. Errors are captured and returned.
    Returns stdout, stderr, and exit code.
    """
    python = _python_bin(workspace_name)
    ws = _ws(workspace_name)
    ws.mkdir(parents=True, exist_ok=True)

    # Write code to a temp file in the workspace
    code_file = ws / "_exec_temp.py"
    code_file.write_text(code, encoding="utf-8")

    try:
        result = subprocess.run(
            [python, str(code_file)],
            capture_output=True, text=True,
            timeout=EXEC_TIMEOUT, cwd=str(ws)
        )
        parts = []
        if result.stdout:
            parts.append(f"OUTPUT:\n{result.stdout.rstrip()}")
        if result.stderr:
            parts.append(f"ERRORS:\n{result.stderr.rstrip()}")
        if not result.stdout and not result.stderr:
            parts.append("Code executed with no output.")
        parts.append(f"Exit code: {result.returncode}")
        return "\n\n".join(parts)
    except subprocess.TimeoutExpired:
        return f"⏱ Execution timed out after {EXEC_TIMEOUT}s"
    finally:
        if code_file.exists():
            code_file.unlink()


@tool
def run_file_in_sandbox(workspace_name: str, file_path: str, args: str = "") -> str:
    """
    Run an existing Python file from the repo workspace using the sandbox Python.
    workspace_name: sandbox name (must have a repo cloned and venv created)
    file_path: path to the .py file relative to the repo root
    args: optional command-line arguments (e.g. '--input data.csv --verbose')
    Returns stdout + stderr with exit code.
    """
    python = _python_bin(workspace_name)
    repo_dir = _ws(workspace_name) / "repo"

    if not repo_dir.exists():
        return f"No repo found in workspace '{workspace_name}'. Clone a repo first."

    target = repo_dir / file_path.lstrip("/")
    if not target.exists():
        return f"File '{file_path}' not found in repo."

    cmd = [python, str(target)] + (args.split() if args else [])
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=EXEC_TIMEOUT, cwd=str(repo_dir)
        )
        parts = []
        if result.stdout:
            parts.append(f"OUTPUT:\n{result.stdout.rstrip()}")
        if result.stderr:
            parts.append(f"ERRORS / TRACEBACKS:\n{result.stderr.rstrip()}")
        parts.append(f"Exit code: {result.returncode}")
        return "\n\n".join(parts)
    except subprocess.TimeoutExpired:
        return f"⏱ Execution timed out after {EXEC_TIMEOUT}s"


@tool
def write_file_in_workspace(workspace_name: str, file_path: str, content: str) -> str:
    """
    Write a file into a workspace (for creating scripts, config files, etc.).
    workspace_name: sandbox/workspace name
    file_path: relative file path (e.g. 'solve.py', 'data/input.csv')
    content: text content to write
    """
    ws = _ws(workspace_name)
    target = ws / file_path.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"✅ Written {target.stat().st_size:,} bytes to '{file_path}' in workspace '{workspace_name}'"
