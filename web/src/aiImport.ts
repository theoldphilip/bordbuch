import { api, errorMessage } from './api.ts';
import type { AnalysisView, Attachment } from './types.ts';

export interface ImportResult {
  /** Attachment ids with proposals waiting for review, cruise documents first. */
  ready: string[];
  failed: { name: string; error: string }[];
  titleSuggestion: string | null;
}

/**
 * Uploads documents one after another (the server analyses each during the request) and returns
 * the ones that produced proposals. Cruise documents come first, so the route already exists
 * when the remaining documents (excursions, transfers) are reviewed.
 */
export async function importDocuments(tripId: string, files: File[], onProgress: (text: string) => void): Promise<ImportResult> {
  const ready: string[] = [];
  const failed: ImportResult['failed'] = [];
  for (const [n, file] of files.entries()) {
    onProgress(`Dokument ${n + 1} von ${files.length}: ${file.name}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ attachment: Attachment }>(`/api/trips/${tripId}/documents`, fd);
      if (res.attachment.analysisStatus === 'done') ready.push(res.attachment.id);
      else failed.push({ name: file.name, error: res.attachment.analysisError ?? 'Dieser Dateityp kann nicht automatisch gelesen werden.' });
    } catch (err) {
      failed.push({ name: file.name, error: errorMessage(err) });
    }
  }
  const views = await Promise.all(
    ready.map((id) =>
      api
        .get<AnalysisView>(`/api/attachments/${id}/analysis`)
        .then((view) => ({ id, view }))
        .catch(() => ({ id, view: null })),
    ),
  );
  views.sort((a, b) => Number(!!b.view?.cruise) - Number(!!a.view?.cruise));
  return {
    ready: views.map((v) => v.id),
    failed,
    titleSuggestion: views.map((v) => v.view?.suggestedTripTitle).find(Boolean) ?? null,
  };
}

export const failedText = (failed: ImportResult['failed']) => failed.map((f) => `${f.name}: ${f.error}`).join('\n');
