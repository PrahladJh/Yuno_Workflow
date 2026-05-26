from langchain_core.tools import tool
import sys
import io
import ast
import traceback


FORBIDDEN = {"open", "exec", "eval", "__import__", "compile", "getattr", "setattr", "delattr", "vars", "dir"}


def _check_safety(code: str):
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in FORBIDDEN:
                raise ValueError(f"Forbidden function: {func.id}")
            if isinstance(func, ast.Attribute) and func.attr in {"system", "popen", "remove", "unlink"}:
                raise ValueError(f"Forbidden method: {func.attr}")
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name in {"os", "subprocess", "sys", "shutil", "socket"}:
                    raise ValueError(f"Forbidden import: {alias.name}")
        if isinstance(node, ast.ImportFrom):
            if node.module in {"os", "subprocess", "sys", "shutil", "socket"}:
                raise ValueError(f"Forbidden import: {node.module}")


@tool
def code_executor_tool(code: str) -> str:
    """Execute a Python code snippet safely and return its output. No file I/O or network calls allowed."""
    try:
        _check_safety(code)
        stdout_capture = io.StringIO()
        old_stdout = sys.stdout
        sys.stdout = stdout_capture
        namespace = {"__builtins__": {"print": print, "len": len, "range": range, "enumerate": enumerate,
                                       "zip": zip, "map": map, "filter": filter, "sorted": sorted,
                                       "sum": sum, "min": min, "max": max, "abs": abs, "round": round,
                                       "str": str, "int": int, "float": float, "bool": bool,
                                       "list": list, "dict": dict, "set": set, "tuple": tuple}}
        exec(compile(code, "<agent_code>", "exec"), namespace)
        sys.stdout = old_stdout
        output = stdout_capture.getvalue()
        return f"Output:\n{output}" if output else "Code executed successfully (no output)"
    except ValueError as e:
        return f"Security error: {str(e)}"
    except Exception as e:
        return f"Execution error: {traceback.format_exc()}"
