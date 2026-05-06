"""RAG pipeline CLI.

Commands:
  ingest [--force]                       Ingest all PDFs → ChromaDB + SQLite
  retrieve --class X --subject Y         Chapter-wise retrieval → JSON stdout
           --chapter Z [--top-k N]
  summarize --class X --subject Y        Topic summarization → JSON stdout
            --topic Z [--source S]       (~2–3 min teacher intro)
            [--lang ta|en] [--top-k N]
  query <text>                           Interactive question → plain text
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(prog="main.py")
    sub = parser.add_subparsers(dest="cmd")

    # ingest
    p_ingest = sub.add_parser("ingest")
    p_ingest.add_argument("--force", action="store_true")
    p_ingest.add_argument("--no-questions", action="store_true",
                          help="Skip Ollama question generation (faster, no LLM calls during ingest)")

    # retrieve  (chapter-scoped — used by lesson blueprint)
    p_ret = sub.add_parser("retrieve")
    p_ret.add_argument("--class", dest="class_name", required=True)
    p_ret.add_argument("--subject", required=True)
    p_ret.add_argument("--chapter", required=True)
    p_ret.add_argument("--top-k", type=int, default=8)

    p_ret_topic = sub.add_parser("retrieve-topic")
    p_ret_topic.add_argument("--class", dest="class_name", required=True)
    p_ret_topic.add_argument("--subject", required=True)
    p_ret_topic.add_argument("--topic", required=True)
    p_ret_topic.add_argument("--top-k", type=int, default=6)

    # summarize  (topic-wide — used by Socratic session intro)
    p_sum = sub.add_parser("summarize")
    p_sum.add_argument("--class", dest="class_name", required=True)
    p_sum.add_argument("--subject", required=True)
    p_sum.add_argument("--topic", required=True)
    p_sum.add_argument("--source", default="curriculum")
    p_sum.add_argument("--lang", default="ta", choices=["ta", "en"])
    p_sum.add_argument("--top-k", type=int, default=12)

    # query  (interactive, human-readable)
    p_query = sub.add_parser("query")
    p_query.add_argument("question", nargs="+")

    args = parser.parse_args()

    if args.cmd == "ingest":
        from ingest import run_ingestion
        run_ingestion(force=args.force, generate_questions=not args.no_questions)

    elif args.cmd == "retrieve":
        from retrieve import run_chapter_retrieve
        run_chapter_retrieve(args.class_name, args.subject, args.chapter, args.top_k)

    elif args.cmd == "retrieve-topic":
        from retrieve import run_topic_retrieve
        run_topic_retrieve(args.class_name, args.subject, args.topic, args.top_k)

    elif args.cmd == "summarize":
        from summarize import run_summarize
        run_summarize(args.class_name, args.subject, args.topic,
                      args.source, args.lang, args.top_k)

    elif args.cmd == "query":
        from retrieve import topic_retrieve
        from langchain_core.messages import HumanMessage
        from langchain_ollama import ChatOllama
        question = " ".join(args.question)
        chunks = topic_retrieve("", "", question, top_k=3)
        context = "\n\n".join(
            f"--- Excerpt {i+1} ---\n{c['text']}" for i, c in enumerate(chunks)
        )
        prompt = f"Answer based on the content below.\n\nCONTENT:\n{context}\n\nQUESTION: {question}\n\nANSWER:"
        llm = ChatOllama(model="gemma4:latest", temperature=0)
        print(llm.invoke([HumanMessage(content=prompt)]).content)

    else:
        parser.print_help()
