# reportloop

AI-powered employee reporting via messaging. Sends human-like scheduled questions
over SMS, WhatsApp, or any Twilio-supported channel, collects and parses responses,
and generates daily/weekly/monthly reports.

Built with LangGraph and MCP.

---

## Description

Daily/weekly/monthly report managed by AI. Send questions via messaging to get
periodic reports from your employees. Questions are rewritten to sound human —
never repeated verbatim — and scheduled in randomized time intervals to feel natural.

---

## Components

| Component | Description | Docs |
|---|---|---|
| Backend | REST API, AI graph orchestration, scheduling | [docs/backend.md](docs/backend.md) |
| Frontend | Web UI for managing subjects, questions, reminders | [docs/frontend.md](docs/frontend.md) |
| MCP Server | Tool layer for AI graph (messaging, parsing, DB) | [docs/mcp-server.md](docs/mcp-server.md) |
| Database | Persists sessions, questions, answers, users | — |

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│                  Frontend                   │
│        Subjects / Questions / Reminders     │
└──────────────────────┬──────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────┐
│                  Backend                    │
│         FastAPI + LangGraph Agent           │
└──────────────────────┬──────────────────────┘
                       │ MCP Client
┌──────────────────────▼──────────────────────┐
│               MCP Server                   │
│   send_message / parse / write_to_db ...   │
└──────────────────────┬──────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
    ┌────▼─────┐              ┌──────▼──────┐
    │ Database │              │   Twilio    │
    │(sessions)│              │SMS/WhatsApp │
    └──────────┘              └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Orchestration | LangGraph |
| Tool Layer | MCP (Model Context Protocol) |
| Messaging | Twilio (SMS, WhatsApp, and more) |
| Backend | Python / FastAPI |
| Frontend | TBD |
| Database | TBD |