# How to Add a New Tool to the MCP Server

Follow the steps in order - each layer depends on the one before it.

**What is a "tool"?**
A tool is a function the AI graph can call to do something in the real world -
send a message, write to a database, generate text, etc.
The MCP server owns and runs all these tools.

---

## Overview - The 5 Layers

```
1. models/       → define the shape of input and output
2. services/     → implement the actual logic (API calls, DB, LLM)
3. tools/        → thin wrapper that calls the service
4. main.py       → register the tool so the server exposes it
5. tests/        → verify every layer works correctly
```

---

## Step 1 - Define the Models

**File:** `src/mcp_server/models/<your_topic>.py`

Models define what data goes **in** and what comes **out** of your tool.
Think of them as a contract - the tool will reject invalid input automatically.

Define an **Input model** with all the fields the tool needs:

```python
from pydantic import BaseModel, Field

class MyToolInput(BaseModel):
    some_field: str = Field(..., description="What this field is for")
    optional_field: int = Field(default=0, description="Optional with a default")
```

Define a **Result model** with what the tool returns on success:

```python
class MyToolResult(BaseModel):
    result_data: str = Field(..., description="The output")
    success: bool = True
```

Add field validators if the data has rules:

```python
from pydantic import field_validator

@field_validator("some_field")
@classmethod
def must_not_be_blank(cls, v: str) -> str:
    if not v.strip():
        raise ValueError("some_field must not be blank")
    return v.strip()
```

---

## Step 2 - Add New Error Codes (if needed)

**File:** `src/mcp_server/core/errors.py`

Only do this step if your tool can fail in a way not covered by an existing code.
Open `errors.py` and add a new value to the `ErrorCode` enum under the relevant section:

```python
class ErrorCode(StrEnum):
    # Add under the right section - Messaging / Database / AI / General
    MY_SERVICE_FAILED  = "my_service_failed"
    MY_SERVICE_TIMEOUT = "my_service_timeout"
```

If your service is a completely new external integration, add a new exception subclass.
If it fits under an existing one (`MessagingError`, `DatabaseError`, `AIError`) - use those instead:

```python
class MyServiceError(MCPToolError):
    """Raised when MyService fails."""
    pass
```

---

## Step 3 - Implement the Service

**File:** `src/mcp_server/services/<your_service>.py`

The service is where the real work happens - it calls the external API, database, or LLM.
The tool layer never does this directly, it always goes through a service.

Create a service class that accepts an injectable client so it can be mocked in tests:

```python
from mcp_server.models.my_topic import MyToolInput, MyToolResult
from mcp_server.core.errors import MyServiceError, ErrorCode
from mcp_server.core.log import get_logger

logger = get_logger(__name__)

class MyService:
    def __init__(self, client=None):
        self._client = client  # injected in tests, auto-created in production
```

Implement the method. Always log at the start and end, and convert external exceptions into `MCPToolError` subclasses:

```python
    async def do_something(self, input: MyToolInput) -> MyToolResult:
        logger.info("Starting do_something", field=input.some_field)
        try:
            raw_result = await self._client.call(input.some_field)
            logger.info("do_something succeeded")
            return MyToolResult(result_data=raw_result)

        except SomeExternalException as e:
            logger.error("do_something failed", error=str(e))
            raise MyServiceError(
                code=ErrorCode.MY_SERVICE_FAILED,
                message=f"Service call failed: {e}",
                retryable=True,
            ) from e
```

If the external service can have transient failures, add a retry decorator:

```python
from mcp_server.core.retry import messaging_retry  # or db_retry / ai_retry

@messaging_retry
async def do_something(self, input: MyToolInput) -> MyToolResult:
    ...
```

If you need a retry decorator for a new service type, add it to `core/retry.py` following the same pattern as the existing ones.

---

## Step 4 - Create the Tool Function

**File:** `src/mcp_server/tools/<your_topic>.py`

The tool is a thin wrapper. It does three things only:
1. Receive the input
2. Call the service
3. Return the result or an error dict

No business logic goes here.

```python
from mcp_server.core.errors import MCPToolError
from mcp_server.core.log import get_logger
from mcp_server.models.my_topic import MyToolInput, MyToolResult
from mcp_server.services.my_service import MyService

logger = get_logger(__name__)
_service = MyService()


async def my_new_tool(input: MyToolInput) -> MyToolResult | dict:
    """
    One clear sentence describing what this tool does.
    The AI graph reads this docstring to decide when to call the tool.
    """
    try:
        return await _service.do_something(input)
    except MCPToolError as e:
        logger.error("my_new_tool failed", error=e.message, code=e.code)
        return e.to_dict()
```

Rules that must always be followed:

| Rule | Reason |
|---|---|
| Always `async def` | MCP tools are always async |
| Return type is `Result \| dict` | Returns result on success, error dict on failure |
| Never raise exceptions | Return `e.to_dict()` - the graph inspects error dicts |
| No business logic | Call the service and return - nothing else |
| Docstring is mandatory | The AI uses it to understand when to call the tool |

---

## Step 5 - Register the Tool

**File:** `src/mcp_server/main.py`

Registering the tool makes it visible to the AI graph.
Without this step, the tool exists but the server doesn't expose it.

Import the function at the top of `main.py`:

```python
from mcp_server.tools.my_topic import my_new_tool
```

Register it with `add_tool`:

```python
mcp.add_tool(my_new_tool)
```

Restart the server and verify the tool appears:

```bash
uv run python -m mcp_server.main

curl http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

---

## Step 6 - Write Tests

### Service tests - `tests/unit/services/test_<your_service>.py`

Mock all external calls - no real HTTP, DB, or LLM calls in unit tests.

```python
@pytest.mark.asyncio
async def test_do_something_success():
    mock_client = AsyncMock(return_value="expected result")
    service = MyService(client=mock_client)
    result = await service.do_something(MyToolInput(some_field="hello"))
    assert result.success is True
    assert result.result_data == "expected result"

@pytest.mark.asyncio
async def test_do_something_raises_on_failure():
    mock_client = AsyncMock(side_effect=SomeExternalException("boom"))
    service = MyService(client=mock_client)
    with pytest.raises(MyServiceError):
        await service.do_something(MyToolInput(some_field="hello"))
```

Cover: happy path, each error case, retryable flag, input passed correctly to the client.

### Tool tests - `tests/unit/tools/test_<your_topic>.py`

Mock the service - tool tests never test service logic.

```python
@pytest.mark.asyncio
async def test_returns_result_on_success():
    with patch("mcp_server.tools.my_topic._service") as mock:
        mock.do_something = AsyncMock(return_value=MyToolResult(result_data="ok"))
        result = await my_new_tool(MyToolInput(some_field="hello"))
    assert isinstance(result, MyToolResult)

@pytest.mark.asyncio
async def test_returns_error_dict_on_failure():
    with patch("mcp_server.tools.my_topic._service") as mock:
        mock.do_something = AsyncMock(
            side_effect=MyServiceError(ErrorCode.MY_SERVICE_FAILED, "failed")
        )
        result = await my_new_tool(MyToolInput(some_field="hello"))
    assert result["success"] is False
```

Cover: success returns the correct result type, service error returns an error dict, input is passed to the service unchanged.

Run all tests:

```bash
pytest tests/unit/ -v
```

---

## Quick Reference - File Map

```
Example: adding tool "send_email"

models/message.py          → SendEmailInput, SendEmailResult
core/errors.py             → EMAIL_DELIVERY_FAILED  (if needed)
services/email_service.py  → EmailService.send()
tools/message.py           → async def send_email(...)
main.py                    → mcp.add_tool(send_email)
tests/unit/services/       → test_email_service.py
tests/unit/tools/          → test_message.py
```