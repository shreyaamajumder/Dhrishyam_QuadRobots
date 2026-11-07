"""A fake chat model for harness tests, so no request is ever sent to OpenAI."""

import asyncio
from types import SimpleNamespace

from harness.llm import LLMClient, LLMSettings


def answer(parsed, input_tokens=100, output_tokens=50):
    """One successful structured answer, in the shape LangChain returns with include_raw."""
    raw = SimpleNamespace(usage_metadata={"input_tokens": input_tokens, "output_tokens": output_tokens})
    return {"raw": raw, "parsed": parsed, "parsing_error": None}


class FakeChatModel:
    """Returns queued outputs in order. An Exception is raised; a number is a delay in seconds."""

    def __init__(self, *outputs):
        self.outputs = list(outputs)
        self.calls = []
        self.schemas = []

    def with_structured_output(self, schema, **options):
        self.schemas.append(schema)
        fake = self

        class Runnable:
            async def ainvoke(self, messages):
                fake.calls.append(messages)
                output = fake.outputs.pop(0)
                if isinstance(output, (int, float)):
                    await asyncio.sleep(output)
                if isinstance(output, Exception):
                    raise output
                return output

        return Runnable()


def fake_client(*outputs, **settings):
    model = FakeChatModel(*outputs)
    options = {"api_key": "sk-test", "timeout_seconds": 1.0, **settings}
    return LLMClient(LLMSettings(**options), model), model
