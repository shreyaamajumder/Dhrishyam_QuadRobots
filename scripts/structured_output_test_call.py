from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from typing import Literal
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

load_dotenv()

model = ChatOpenAI(model="gpt-4o-mini")

parser = StrOutputParser()

prompt = PromptTemplate(
    template = 'Write either a positive or negative or neutral fact (any one) about {topic}.',
    input_variables=['topic']
)

class Sentiment(BaseModel):
    sentiment : Literal["positive", "negative", "neutral"] = Field(description = 'return sentiment of the fact either negative, positive or neutral')

structured_model = model.with_structured_output(Sentiment)

chain = prompt | structured_model

result = chain.invoke({'topic':'Politics'})

print(result)