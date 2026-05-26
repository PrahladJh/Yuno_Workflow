from langchain_core.tools import tool
import ast
import operator


SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
}


def _safe_eval(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        op = type(node.op)
        if op not in SAFE_OPS:
            raise ValueError(f"Unsupported operator: {op}")
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        return SAFE_OPS[op](left, right)
    if isinstance(node, ast.UnaryOp):
        op = type(node.op)
        if op not in SAFE_OPS:
            raise ValueError(f"Unsupported operator: {op}")
        return SAFE_OPS[op](_safe_eval(node.operand))
    raise ValueError(f"Unsupported expression type: {type(node)}")


@tool
def calculator_tool(expression: str) -> str:
    """Evaluate a mathematical expression safely. Supports +, -, *, /, **, %, //. Example: '2 ** 10 + 5 * 3'"""
    try:
        tree = ast.parse(expression.strip(), mode='eval')
        result = _safe_eval(tree.body)
        return f"Result: {result}"
    except ZeroDivisionError:
        return "Error: Division by zero"
    except Exception as e:
        return f"Calculation error: {str(e)}"
