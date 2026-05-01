export type SubjectName = "english";

export interface RetrieverChunk {
  text: string;
  score: number;
  grade: string;
  subject: string;
  chapter: string;
  page: number;
  language: string;
  source_file: string;
}

export async function retrieveTextbookChunks(
  _grade: string,
  _subject: SubjectName,
  _query: string,
  _topK = 3,
): Promise<RetrieverChunk[]> {
  return [];
}
