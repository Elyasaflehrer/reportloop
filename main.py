import asyncio
from typing import TypedDict, List, Dict, Any

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent


# ----------------------------
# STATE (optional for tracking)
# ----------------------------
class GraphState(TypedDict):
    questions: List[str]
    cleaned_questions: List[str]
    has_suspicious: bool


# ----------------------------
# MCP CLIENT (correct way)
# ----------------------------
mcp_client = MultiServerMCPClient(
    {
        "local-mcp": {
            "url": "http://localhost:8000",
            "transport": "streamable_http",  # important for MCP
        }
    }
)


# ----------------------------
# LLM
# ----------------------------
llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0
)


# ----------------------------
# MAIN PIPELINE
# ----------------------------
async def main():

    # Load MCP tools automatically
    tools = await mcp_client.get_tools()

    print("Available tools:", [t.name for t in tools])
    # Create ReAct agent with MCP tools
    agent = create_react_agent(
        model=llm,
        tools=tools,
    )

    # ----------------------------
    # STEP 1: Generate questions
    # ----------------------------
    result = await agent.ainvoke({
        "messages": [
            {
                "role": "user",
                "content": "Call Generated_Humen_questions tool and return questions"
            }
        ]
    })

    questions = result["messages"][-1].content

    # ----------------------------
    # LOOP CLEANING UNTIL SAFE
    # ----------------------------
    cleaned = None
    has_suspicious = True

    while has_suspicious:

        result = await agent.ainvoke({
            "messages": [
                {
                    "role": "user",
                    "content": f"""
Use Clean_suspicious_signs tool.

Input questions:
{questions}

Return:
- cleaned_questions
- has_suspicious
"""
                }
            ]
        })

        output = result["messages"][-1].content

        # NOTE: assuming MCP returns JSON-like text
        # If your MCP returns structured output, we can improve this parsing
        import json

        data = json.loads(output)

        cleaned = data["cleaned_questions"]
        has_suspicious = data["has_suspicious"]

        questions = cleaned  # feed back into loop

    # ----------------------------
    # FINAL OUTPUT
    # ----------------------------
    print("\n✅ FINAL HUMAN QUESTIONS:\n")
    for i, q in enumerate(cleaned, 1):
        print(f"{i}. {q}")

    return cleaned


# ----------------------------
# RUN
# ----------------------------
if __name__ == "__main__":
    asyncio.run(main())