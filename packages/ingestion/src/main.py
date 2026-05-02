"""Multi-modal RAG ingestion + retrieval pipeline.

This file is a direct port of the reference notebook
``multi_modal_rag.ipynb``. The ingestion logic, chunking strategy, AI
summary prompt structure, multimodal answer-generation chain, and the
way images are stored as base64 inside chunk metadata are all kept the
same as the notebook. Only three things are changed:

1. Cloud LLM (OpenAI/Vertex) swapped for a local Ollama model
   (``gemma4`` for chat, ``nomic-embed-text`` for embeddings).
2. ChromaDB is opened as a persistent client at ``./chroma_db`` with
   the collection name ``mm_rag_pipeline``.
3. HyDE (Hypothetical Document Embeddings) is added in two places:
   chunk-time hypothetical questions are prepended to the embedded
   summary, and at query-time a hypothetical answer is generated and
   used as the retrieval query in place of the raw question.

A small CLI is exposed at the bottom of the file:
    python src/main.py ingest
    python src/main.py query "your question"
"""

import json
import os
import sys
from pathlib import Path
from typing import List

# Unstructured: PDF parsing + title-based chunking.
from unstructured.partition.pdf import partition_pdf
from unstructured.chunking.title import chunk_by_title


from langchain_core.documents import Document
from langchain_core.messages import HumanMessage

# Ollama wrappers
from langchain_ollama import ChatOllama, OllamaEmbeddings

# Chroma vector store
from langchain_chroma import Chroma
import chromadb


# Directory holding the input PDFs to ingest.
PDF_DIR = "./data/pdfs/"


# Persistent ChromaDB location and collection name.
CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "mm_rag_pipeline"

# Local Ollama model identifiers. ``gemma4`` is the chat model used
# for both summarization and final answer generation; the embedding
# model is the standard local Nomic embedding.
LLM_MODEL = "gemma4:latest"
EMBEDDING_MODEL = "nomic-embed-text"

# Module-level singletons. Building them once avoids re-establishing
# Ollama connections for every chunk during ingestion.
llm = ChatOllama(model=LLM_MODEL, temperature=0)
embeddings = OllamaEmbeddings(model=EMBEDDING_MODEL)


# ============================================================
# PDF Extraction - Using Unstructured library
# ============================================================
def partition_document(file_path: str):
    """Run Unstructured's hi-res PDF partitioner against one PDF.

    Args:
        file_path: Absolute or relative path to a single PDF.

    Returns:
        A list of unstructured ``Element`` objects (Title,
        NarrativeText, Table, Image, etc.) in document order.
    """
    print(f"📄 Partitioning document: {file_path}")

    elements = partition_pdf(
        filename=file_path,  
        strategy="hi_res", # Use the most accurate (but slower) processing method of extraction
        infer_table_structure=True, # Keep tables as structured HTML, not jumbled text
        extract_image_block_types=["Image"], # Grab images found in the PDF
        extract_image_block_to_payload=True # Store images as base64 data you can actually use
    )
    
    print(f"✅ Extracted {len(elements)} elements")
    return elements


def create_chunks_by_title(elements):
    """Group raw Unstructured elements into title-bounded chunks.

    Args:
        elements: Output of :func:`partition_document`.

    Returns:
        A list of ``CompositeElement`` chunks, each with the original
        elements available on ``chunk.metadata.orig_elements``.
    """
    print("🔨 Creating smart chunks...")

    chunks = chunk_by_title(
        elements,
        max_characters=3000,
        new_after_n_chars=2400,
        combine_text_under_n_chars=500,
    )

    print(f"✅ Created {len(chunks)} chunks")
    return chunks


# ============================================================
# Text and Table Summarization
# ============================================================
def separate_content_types(chunk):
    """Pull text, tables, and images out of one composite chunk.

    A title-based chunk usually carries a body of narrative text plus
    zero or more tables/images that lived under the same heading.
    This helper flattens those into three parallel lists so the
    summarization step can format them into a single multimodal
    prompt.

    Args:
        chunk: One ``CompositeElement`` returned by
            :func:`create_chunks_by_title`.

    Returns:
        Dict with ``text`` (str), ``tables`` (list of HTML strings),
        ``images`` (list of base64 strings), and ``types`` (set of
        modality tags found in the chunk).
    """
    content_data = {
        "text": chunk.text,
        "tables": [],
        "images": [],
        "types": ["text"],
    }

    # The original elements live on ``orig_elements``; we only need
    # them when the chunk is mixed-modality. Plain-text chunks fall
    # straight through with an empty tables/images list.
    if hasattr(chunk, "metadata") and hasattr(chunk.metadata, "orig_elements"):
        for element in chunk.metadata.orig_elements:
            element_type = type(element).__name__

            # Tables: prefer the HTML rendering Unstructured produces
            # because it preserves row/column structure, which is
            # what we want both the summarizer and the final answer
            # model to see.
            if element_type == "Table":
                content_data["types"].append("table")
                table_html = getattr(
                    element.metadata, "text_as_html", element.text
                )
                content_data["tables"].append(table_html)

            # Images: only include them if Unstructured actually
            # produced a base64 payload (i.e. payload extraction was
            # enabled and the image was successfully decoded).
            elif element_type == "Image":
                if hasattr(element, "metadata") and hasattr(
                    element.metadata, "image_base64"
                ):
                    content_data["types"].append("image")
                    content_data["images"].append(
                        element.metadata.image_base64
                    )

    # Deduplicate the modality tags so the caller can quickly check
    # ``"image" in types`` without worrying about repeats.
    content_data["types"] = list(set(content_data["types"]))
    return content_data


def create_ai_enhanced_summary(
    text: str, tables: List[str], images: List[str]
) -> str:
    """Build one searchable description for a mixed-modality chunk.

    The model is asked to produce a long, retrieval-friendly 
    description that surfaces key facts, alternative search terms,
    and observations about any tables or images. Images are passed 
    as ``image_url`` parts on a single ``HumanMessage`` so a vision-capable Ollama model (e.g.``gemma4``) can read them.

    Args:
        text: Raw narrative text of the chunk.
        tables: List of HTML strings, one per table in the chunk.
        images: List of base64-encoded JPEG/PNG image payloads.

    Returns:
        The model's generated description, or a degraded text-only
        fallback if the model call raises.
    """
    try:
        # Header of the prompt
        prompt_text = f"""You are creating a searchable description for document content retrieval.

        CONTENT TO ANALYZE:
        TEXT CONTENT:
        {text}

        """

        # Inline each table's HTML so the model sees structure. The
        # closing instruction block is appended only after the tables
        # are listed (matching the notebook's indentation quirk).
        if tables:
            prompt_text += "TABLES:\n"
            for i, table in enumerate(tables):
                prompt_text += f"Table {i+1}:\n{table}\n\n"

                prompt_text += """
                YOUR TASK:
                Generate a comprehensive, searchable description that covers:

                1. Key facts, numbers, and data points from text and tables
                2. Main topics and concepts discussed
                3. Questions this content could answer
                4. Visual content analysis (charts, diagrams, patterns in images)
                5. Alternative search terms users might use

                Make it detailed and searchable - prioritize findability over brevity.

                SEARCHABLE DESCRIPTION:"""

        message_content = [{"type": "text", "text": prompt_text}]
        for image_base64 in images:
            message_content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_base64}"
                    },
                }
            )

        message = HumanMessage(content=message_content)
        response = llm.invoke([message])

        return response.content

    except Exception as e:
        # Degraded fallback: at least keep enough of the raw text and
        # a count of attachments so the chunk is still indexable when
        # the model is unreachable.
        print(f"     ❌ AI summary failed: {e}")
        summary = f"{text[:300]}..."
        if tables:
            summary += f" [Contains {len(tables)} table(s)]"
        if images:
            summary += f" [Contains {len(images)} image(s)]"
        return summary


# ============================================================
# HyDE — Hypothetical Question Generation
# ============================================================
def generate_hypothetical_questions(summary: str, n: int = 3) -> List[str]:
    """Ask the LLM for ``n`` questions a chunk's summary could answer.

    Prepending these to the embedded summary aligns each chunk with
    how users actually phrase queries: a natural-language question is
    semantically closer to a question than to a description. This is
    one half of the HyDE addition — the other half lives in
    :func:`run_query`.

    Args:
        summary: The chunk's AI-generated description.
        n: Number of questions to ask for (default 3).

    Returns:
        A list of question strings, possibly empty if the model fails
        or returns nothing parseable.
    """
    prompt = (
        f"Read the passage below and write {n} concise, distinct "
        f"questions that this passage directly answers. Output one "
        f"question per line, no numbering, no bullets.\n\n"
        f"PASSAGE:\n{summary}\n\nQUESTIONS:"
    )
    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        # Split on newlines and drop blanks/short noise lines.
        questions = [
            line.strip("-• 0123456789.\t ")
            for line in response.content.splitlines()
            if line.strip()
        ]
        return [q for q in questions if len(q) > 5][:n]
    except Exception as e:
        print(f"     ⚠️  HyDE question generation failed: {e}")
        return []


def generate_hypothetical_answer(question: str) -> str:
    """Generate a fake answer to ``question`` for use as a retrieval query.

    HyDE: a model-written hypothetical answer is usually closer in
    embedding space to the real chunk summaries than the user's
    short question is, so retrieval recall improves when we embed
    the hypothetical answer instead of the raw question.

    Args:
        question: The user's natural-language question.

    Returns:
        A short hypothetical answer, or the original question if the
        LLM call fails (so retrieval still works).
    """
    prompt = (
        "Write a short, plausible answer to the question below. "
        "Do not refuse, do not say you don't know — invent details "
        "if you must, since this is only used for retrieval, not "
        "shown to the user.\n\n"
        f"QUESTION: {question}\n\nANSWER:"
    )
    try:
        response = llm.invoke([HumanMessage(content=prompt)])
        return response.content.strip() or question
    except Exception as e:
        print(f"⚠️  HyDE answer generation failed, falling back to raw query: {e}")
        return question


def summarise_chunks(chunks, class_name: str, subject: str, source_file: str):
    """Turn each chunk into a LangChain ``Document`` ready for embedding.

    For every chunk we:

    1. Split the chunk into text / tables / images.
    2. If it has tables or images, run the multimodal summary call;
       otherwise just keep the raw text as the searchable surface.
    3. Generate 2–3 HyDE-style hypothetical questions and prepend
       them to the summary so the embedding sees both the answer
       (description) and likely question phrasings.
    4. Pack the raw text, the table HTML, and the image base64 list
       into the document's ``metadata.original_content`` field so
       the answer step can reconstruct the full multimodal context.

    Args:
        chunks: List of composite chunks.
        class_name: Class folder name (e.g. ``class_1``).
        subject: Subject derived from the PDF filename stem.
        source_file: Original PDF filename, for traceability.

    Returns:
        A list of ``Document`` objects, one per chunk, in chunk order.
    """
    print("🧠 Processing chunks with AI Summaries...")

    langchain_documents = []
    total_chunks = len(chunks)

    for i, chunk in enumerate(chunks):
        current_chunk = i + 1
        print(f"   Processing chunk {current_chunk}/{total_chunks}")

        # structurally split the chunk into modalities.
        content_data = separate_content_types(chunk)

        print(f"     Types found: {content_data['types']}")
        print(
            f"     Tables: {len(content_data['tables'])}, "
            f"Images: {len(content_data['images'])}"
        )

        # produce the searchable description. Only call the
        # multimodal model if there is actually non-text content;
        # otherwise the raw text is already the best embedding
        # surface and we save a model round-trip.
        if content_data["tables"] or content_data["images"]:
            print("     → Creating AI summary for mixed content...")
            try:
                enhanced_content = create_ai_enhanced_summary(
                    content_data["text"],
                    content_data["tables"],
                    content_data["images"],
                )
                print("     → AI summary created successfully")
            except Exception as e:
                print(f"     ❌ AI summary failed: {e}")
                enhanced_content = content_data["text"]
        else:
            print("     → Using raw text (no tables/images)")
            enhanced_content = content_data["text"]

        # Step 3: HyDE — generate likely user questions for this
        # chunk and prepend them. Only the embedded ``page_content``
        # changes; the original_content payload still holds the raw
        # text and attachments for the answer model.
        hypothetical_qs = generate_hypothetical_questions(enhanced_content)
        if hypothetical_qs:
            qs_block = "\n".join(f"Q: {q}" for q in hypothetical_qs)
            embedded_text = f"{qs_block}\n\n{enhanced_content}"
        else:
            embedded_text = enhanced_content

        # Step 4: stash the raw modalities in metadata as JSON. so the rest of the
        # answer pipeline (which reads ``original_content``) needs no change.
        doc = Document(
            page_content=embedded_text,
            metadata={
                "class": class_name,
                "subject": subject,
                "source_file": source_file,
                "original_content": json.dumps(
                    {
                        "raw_text": content_data["text"],
                        "tables_html": content_data["tables"],
                        "images_base64": content_data["images"],
                    }
                ),
            },
        )

        langchain_documents.append(doc)

    print(f"✅ Processed {len(langchain_documents)} chunks")
    return langchain_documents


# ============================================================
#  Multi-Vector Retriever Setup
# ============================================================
def get_vectorstore() -> Chroma:
    """Open (or create) the persistent Chroma collection.

    Using an explicit ``PersistentClient`` keeps the on-disk path and
    collection name visible at the call site, and lets us reuse the
    same collection between ``run_ingestion`` (writes) and
    ``run_query`` (reads) without re-specifying ``persist_directory``.

    Returns:
        A :class:`langchain_chroma.Chroma` bound to the
        ``mm_rag_pipeline`` collection at ``CHROMA_PATH``.
    """
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    return Chroma(
        client=client,
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
    )


def create_vector_store(documents: List[Document]) -> Chroma:
    """Embed and persist a batch of documents into the collection.

    Args:
        documents: Output of :func:`summarise_chunks`.

    Returns:
        The Chroma vector store, with the new documents added.
    """
    print("🔮 Creating embeddings and storing in ChromaDB...")
    vectorstore = get_vectorstore()

    # ``add_documents`` appends; we deliberately do not wipe the
    # collection here so multiple PDFs can be ingested incrementally.
    print("--- Adding documents to vector store ---")
    vectorstore.add_documents(documents)
    print("--- Finished adding documents ---")

    print(f"✅ Vector store updated at {CHROMA_PATH}")
    return vectorstore


# ============================================================
#  RAG Chain — Retrieval and Answer Generation
# ============================================================
def generate_final_answer(retrieved_chunks: List[Document], query: str) -> str:
    """Compose a multimodal prompt from retrieved chunks and answer.

   ``generate_final_answer``: every retrieved
    document contributes its raw text and any tables (HTML) to a
    single text prompt; every image base64 across all retrieved
    documents is appended as an ``image_url`` part. This lets a
    vision model ground the answer in the actual figures from the
    source PDF, not just the AI summary that was used for retrieval.

    Args:
        retrieved_chunks: Documents returned by the retriever.
        query: The user's original natural-language question.

    Returns:
        The model's answer text, or a fallback error string.
    """
    try:
        # Build the textual portion of the prompt by walking each
        # retrieved document and emitting its raw text + tables.
        prompt_text = (
            f"Based on the following documents, please answer this "
            f"question: {query}\n\nCONTENT TO ANALYZE:\n"
        )

        for i, chunk in enumerate(retrieved_chunks):
            prompt_text += f"--- Document {i+1} ---\n"

            if "original_content" in chunk.metadata:
                original_data = json.loads(chunk.metadata["original_content"])

                raw_text = original_data.get("raw_text", "")
                if raw_text:
                    prompt_text += f"TEXT:\n{raw_text}\n\n"

                tables_html = original_data.get("tables_html", [])
                if tables_html:
                    prompt_text += "TABLES:\n"
                    for j, table in enumerate(tables_html):
                        prompt_text += f"Table {j+1}:\n{table}\n\n"

            prompt_text += "\n"

        prompt_text += (
            "\nPlease provide a clear, comprehensive answer using the "
            "text, tables, and images above. If the documents don't "
            "contain sufficient information to answer the question, "
            'say "I don\'t have enough information to answer that '
            'question based on the provided documents."\n\nANSWER:'
        )

        # Multimodal message: text first, then every image from
        # every retrieved chunk as a separate image_url part.
        message_content = [{"type": "text", "text": prompt_text}]
        for chunk in retrieved_chunks:
            if "original_content" in chunk.metadata:
                original_data = json.loads(chunk.metadata["original_content"])
                for image_base64 in original_data.get("images_base64", []):
                    message_content.append(
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            },
                        }
                    )

        message = HumanMessage(content=message_content)
        response = llm.invoke([message])
        return response.content

    except Exception as e:
        print(f"❌ Answer generation failed: {e}")
        return "Sorry, I encountered an error while generating the answer."


def run_ingestion() -> None:
    """Ingest every PDF under ``./data/pdfs/<class>/<subject>.pdf``.

    Folder layout: each PDF lives in a class folder (e.g. ``class_1``)
    and the filename stem is treated as the subject (``maths.pdf`` →
    subject ``maths``). Class and subject are stored on every chunk's
    metadata so queries can later filter by them.

    Pipeline per file: partition → chunk → summarise (with HyDE
    questions prepended) → upsert into Chroma. Errors on any single
    PDF are caught so one bad file doesn't kill the whole batch.
    """
    print("🚀 Starting RAG Ingestion Pipeline")
    print("=" * 50)

    base = Path(PDF_DIR)
    pdf_files = sorted(base.rglob("*.pdf"))

    if not pdf_files:
        print(f"⚠️  No PDFs found in {PDF_DIR}.")
        return

    for pdf_path in pdf_files:
        rel = pdf_path.relative_to(base)
        if len(rel.parts) < 2:
            print(
                f"⚠️  Skipping {pdf_path.name}: expected "
                f"{PDF_DIR}<class>/<subject>.pdf"
            )
            continue

        class_name = pdf_path.parent.name
        subject = pdf_path.stem
        print(f"\n📚 Ingesting: {class_name}/{pdf_path.name}")
        try:
            elements = partition_document(str(pdf_path))
            chunks = create_chunks_by_title(elements)
            summarised = summarise_chunks(
                chunks,
                class_name=class_name,
                subject=subject,
                source_file=pdf_path.name,
            )
            create_vector_store(summarised)
        except Exception as e:
            # Keep going — failing one file should not block others.
            print(f"❌ Failed to ingest {pdf_path.name}: {e}")

    print("\n🎉 Pipeline completed.")


def run_query(question: str) -> None:
    """Answer ``question`` against the persisted vector store.

    Steps: HyDE-expand the question into a hypothetical answer →
    retrieve top-k chunks against that expansion → reconstruct the
    multimodal prompt from the retrieved chunks' raw text, tables,
    and images → call the LLM and print the answer.

    Args:
        question: The user's natural-language question.
    """
    print(f"❓ Query: {question}")

    vectorstore = get_vectorstore()

    # HyDE step: turn the short user question into a plausible
    # answer-shaped paragraph, then retrieve against that expansion.
    hypothetical = generate_hypothetical_answer(question)
    print(f"🧪 HyDE expansion (used as retrieval query):\n{hypothetical}\n")

    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})
    retrieved = retriever.invoke(hypothetical)
    print(f"📥 Retrieved {len(retrieved)} chunks")

    # Final answer is generated against the original user question
    # (not the HyDE expansion) so the model sees what was actually
    # asked.
    answer = generate_final_answer(retrieved, question)
    print("\n💡 Answer:\n")
    print(answer)


# ============================================================
#  CLI Entry Point
# ============================================================
if __name__ == "__main__":
    # Two subcommands: ``ingest`` runs the full pipeline over every
    # PDF in ``./data/pdfs/``; ``query`` takes the rest of argv as
    # the question and runs retrieval + answer generation.
    if len(sys.argv) > 1 and sys.argv[1] == "ingest":
        run_ingestion()
    elif len(sys.argv) > 2 and sys.argv[1] == "query":
        run_query(" ".join(sys.argv[2:]))
    else:
        print("Usage:")
        print("  python src/main.py ingest")
        print('  python src/main.py query "your question here"')
