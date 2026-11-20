import { api, errorMessage } from './api.ts';
import type { AnalysisView, Attachment } from './types.ts';

/** One thing the user wants analysed: a file, a screenshot from the clipboard, or pasted text. */
export interface ImportInput {
  id: string;
  file: File;
  kind: 'file' | 'screenshot' | 'text';
  label: string;
}

export interface ImportResult {
  /** Attachment ids with proposals waiting for review, cruise documents first. */
  ready: string[];
  failed: { name: string; error: string }[];
  titleSuggestion: string | null;
}

const NOT_READABLE = 'Dieser Dateityp kann nicht automatisch gelesen werden.';

const form = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return fd;
};

/**
 * Uploads the inputs and lets the server analyse them. Either every input on its own, or (grouped)
 * all together as one document, e.g. several screenshots of the same booking page.
 * Cruise documents come first in the result, so the route exists when the rest is reviewed.
 */
export async function runImport(tripId: string, inputs: ImportInput[], grouped: boolean, onProgress: (text: string) => void): Promise<ImportResult> {
  const ready: string[] = [];
  const failed: ImportResult['failed'] = [];

  if (grouped && inputs.length >= 2) {
    const ids: string[] = [];
    for (const [n, input] of inputs.entries()) {
      onProgress(`Lädt hoch ${n + 1} von ${inputs.length}: ${input.label}`);
      try {
        ids.push((await api.post<Attachment>(`/api/trips/${tripId}/attachments`, form(input.file))).id);
      } catch (err) {
        failed.push({ name: input.label, error: errorMessage(err) });
      }
    }
    if (ids.length > 0) {
      onProgress(ids.length > 1 ? `Analysiert ${ids.length} Dateien zusammen` : 'Analysiert');
      try {
        const res =
          ids.length > 1
            ? await api.post<{ attachment: Attachment }>(`/api/trips/${tripId}/documents/group`, { attachmentIds: ids })
            : { attachment: await api.post<Attachment>(`/api/attachments/${ids[0]}/analyze`) };
        if (res.attachment.analysisStatus === 'done') ready.push(res.attachment.id);
        else failed.push({ name: 'Zusammengefasste Unterlage', error: res.attachment.analysisError ?? NOT_READABLE });
      } catch (err) {
        failed.push({ name: 'Zusammengefasste Unterlage', error: errorMessage(err) });
      }
    }
  } else {
    for (const [n, input] of inputs.entries()) {
      onProgress(`Dokument ${n + 1} von ${inputs.length}: ${input.label}`);
      try {
        const res = await api.post<{ attachment: Attachment }>(`/api/trips/${tripId}/documents`, form(input.file));
        if (res.attachment.analysisStatus === 'done') ready.push(res.attachment.id);
        else failed.push({ name: input.label, error: res.attachment.analysisError ?? NOT_READABLE });
      } catch (err) {
        failed.push({ name: input.label, error: errorMessage(err) });
      }
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
