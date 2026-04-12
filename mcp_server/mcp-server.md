# MCP Server

The MCP server is the tool layer of the AI graph. It owns all external integrations
and side effects. The LangGraph graph calls these tools via the MCP client —
it never interacts with Twilio, the database, or the LLM directly.

This separation means every tool can be tested independently without running the graph.

---

## Separation of Concerns

| Concern | Owner |
|---|---|
| What to do and when | LangGraph (graph nodes + edges) |
| How to do it | MCP Server (tools) |
| Routing decisions | LangGraph (router nodes) |
| External integrations | MCP Server only |

---

## Tools

### `generate_questions`

Rewrite a list of questions to sound human-like.
Never produce the exact same phrasing twice.

```python
@mcp.tool()
async def generate_questions(
    questions: list[str],
    previous_versions: list[str] = []
) -> list[str]:
    ...
```

### `clean_suspicious_signs`

Iterate over the question list and remove AI-generated patterns
such as long hyphens (—), excessive formatting, or unnatural punctuation.

```python
@mcp.tool()
async def clean_suspicious_signs(
    questions: list[str]
) -> list[str]:
    ...
```

### `send_message`

Send a message to a list of recipients via the configured Twilio channel.
Supports SMS, WhatsApp, and any other Twilio-supported channel.

```python
@mcp.tool()
async def send_message(
    to: list[str],
    message: str,
    channel: str  # "sms" | "whatsapp"
) -> dict:
    ...
```

### `send_reminder`

Send a follow-up reminder message to recipients who have not yet responded.

```python
@mcp.tool()
async def send_reminder(
    to: list[str],
    original_questions: list[str],
    reminder_count: int,
    channel: str
) -> dict:
    ...
```

### `not_answered_and_report`

Called when the maximum number of reminders has been reached with no response.
Logs the failure and generates a report of unanswered questions.

```python
@mcp.tool()
async def not_answered_and_report(
    session_id: str,
    unanswered_questions: list[str],
    phone: str
) -> dict:
    ...
```

### `write_to_db`

Persist the completed session to the database.
Handles upsert logic so re-runs are idempotent.

```python
@mcp.tool()
async def write_to_db(
    session_id: str,
    questions: list[str],
    original_response: str,
    parsed_answers: dict[str, str],
    user_data: dict,
    completed_at: str
) -> dict:
    ...
```

---

## Project Structure

```
mcp_server/
├── server.py
├── tools/
│   ├── message_tools.py
│   ├── question_tools.py
│   ├── db_tools.py
│   └── report_tools.py
├── services/
│   ├── twilio.py
│   ├── llm.py
│   └── database.py
├── models/
│   ├── message.py
│   ├── question.py
│   └── database.py
├── core/
│   ├── config.py
│   ├── errors.py
│   ├── log.py
│   └── retry.py
```

# Implemantations
1. langGraph
2. The build structure
