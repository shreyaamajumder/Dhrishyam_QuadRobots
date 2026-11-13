"""A fake chat model for harness tests, so no request is ever sent to OpenAI."""

import asyncio
from types import SimpleNamespace

from harness.llm import LLMClient, LLMSettings


def answer(parsed, input_tokens=100, output_tokens=50):
    """One successful structured answer, in the shape LangChain returns with include_raw."""
    raw = SimpleNamespace(usage_metadata={"input_tokens": input_tokens, "output_tokens": output_tokens})
    return {"raw": raw, "parsed": parsed, "parsing_error": None}


class FakeChatModel:
    """Returns queued outputs. An Exception is raised; a number is a delay in seconds.

    Outputs are either one queue, used in call order, or a dict of queues keyed by the answer
    schema's class name. Use the dict when calls run in parallel, as the specialists do.
    """

    def __init__(self, *outputs, by_schema=None):
        self.outputs = list(outputs)
        self.by_schema = {name: list(queue) for name, queue in (by_schema or {}).items()}
        self.calls = []
        self.schemas = []

    def calls_for(self, schema_name):
        return [messages for name, messages in self.calls if name == schema_name]

    def with_structured_output(self, schema, **options):
        self.schemas.append(schema)
        fake = self

        class Runnable:
            async def ainvoke(self, messages):
                fake.calls.append((schema.__name__, messages))
                queue = fake.by_schema.get(schema.__name__, fake.outputs)
                if not queue:
                    raise RuntimeError(f"no fake answer queued for {schema.__name__}")
                output = queue.pop(0)
                if isinstance(output, (int, float)):
                    await asyncio.sleep(output)
                if isinstance(output, Exception):
                    raise output
                return output

        return Runnable()


def fake_client(*outputs, by_schema=None, **settings):
    model = FakeChatModel(*outputs, by_schema=by_schema)
    options = {"api_key": "sk-test", "timeout_seconds": 1.0, **settings}
    return LLMClient(LLMSettings(**options), model), model
