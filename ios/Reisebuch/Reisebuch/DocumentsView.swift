//
//  DocumentsView.swift
//  Reisebuch
//
//  Dokumente einer Reise (Auftrag 0.7.0, erweitert in 0.8.0, seit 0.9.0 als Reiter): Liste mit Status, Ansehen mit Quick Look, Hinzufügen (Dateien, Fotos,
//  Scanner, Text; einzeln oder zusammen ausgewertet), Löschen. Vorschläge prüfen wie DocReview.tsx: je Vorschlag übernehmen/überspringen,
//  vor dem Übernehmen bearbeiten (nur im Speicher), Recherche im Internet wie ResearchPanel.tsx, Reisename aus dem Vorschlag der KI.
//

import QuickLook
import SwiftUI
import UIKit
import VisionKit

/// Reisename aus dem Vorschlag der KI übernehmen, solange die Reise „Neue Reise“ heißt (wie die Web-App beim Start aus Dokumenten).
enum TitleAdoption {
    static func run(session: AppSession, edit: EditContext, suggestion: String?) async -> Bool {
        guard let title = TripTitle.adopt(current: edit.tripTitle, suggestion: suggestion) else { return false }
        guard (try? await session.call { try await $0.patchTrip(tripId: edit.tripId, ["title": .string(title)]) }) != nil else { return false }
        _ = try? await session.fetchTrips()
        await edit.reload()
        return true
    }
}

// MARK: - Liste

struct DocumentsView: View {
    @Environment(AppSession.self) private var session
    let edit: EditContext
    let itemTitles: [String: String]

    @State private var attachments: [Attachment]
    @State private var message: String?
    @State private var errorText: String?
    @State private var previewURL: URL?
    @State private var loadingId: String?
    @State private var reviewId: ReviewTarget?
    @State private var showAdd = false
    @State private var toDelete: Attachment?
    @State private var titleChecked = false

    struct ReviewTarget: Identifiable { let id: String }

    init(edit: EditContext, itemTitles: [String: String], initial: [Attachment]) {
        self.edit = edit
        self.itemTitles = itemTitles
        _attachments = State(initialValue: initial)
    }

    private var visible: [Attachment] { DocumentStatus.visible(attachments) }

    var body: some View {
        List {
            if let errorText {
                Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }
            if let message {
                Section { Label(message, systemImage: "checkmark.circle").foregroundStyle(.secondary) }
            }
            if visible.isEmpty {
                Section { Text("Noch keine Dokumente.").foregroundStyle(.secondary) }
            }
            Section {
                ForEach(visible) { a in
                    row(a)
                        .swipeActions {
                            if edit.canEdit {
                                Button("Löschen", role: .destructive) { toDelete = a }
                            }
                        }
                }
            } footer: {
                if edit.canEdit && !visible.isEmpty { Text("Zum Löschen nach links wischen.") }
            }
        }
        .toolbar {
            if edit.canEdit {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Dokumente hinzufügen")
                }
            }
        }
        .refreshable { await reload() }
        .task { await adoptTitleIfNeeded() }
        .task(id: DocumentStatus.anyPending(attachments)) {
            // Solange etwas gelesen wird und die Liste sichtbar ist: alle 5 s neu laden.
            while DocumentStatus.anyPending(attachments) && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { break }
                await reload()
            }
        }
        .quickLookPreview($previewURL)
        .onChange(of: previewURL) { old, new in
            if new == nil, let old { try? FileManager.default.removeItem(at: old.deletingLastPathComponent()) }
        }
        .sheet(item: $reviewId) { target in
            DocReviewView(attachmentId: target.id, edit: edit) { Task { await reload() } }
        }
        .sheet(isPresented: $showAdd) {
            AddDocumentsView(tripId: edit.tripId) { text in
                message = text
                Task { await reload() }
            }
        }
        .confirmationDialog("„\(toDelete?.filename ?? "")“ löschen?", isPresented: Binding(get: { toDelete != nil },
                                                                                          set: { if !$0 { toDelete = nil } }),
                            titleVisibility: .visible) {
            Button("Löschen", role: .destructive) {
                if let a = toDelete { Task { await delete(a) } }
            }
        }
    }

    @ViewBuilder
    private func row(_ a: Attachment) -> some View {
        Button {
            Task { await open(a) }
        } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(a.filename).foregroundStyle(.primary).lineLimit(2)
                    let sub = [a.createdAt.map { Fmt.local(String($0.prefix(10))) }, a.itemId.flatMap { itemTitles[$0] }]
                        .compactMap { $0 }.joined(separator: " · ")
                    if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(.secondary) }
                    if let status = DocumentStatus.text(a) {
                        Text(status).font(.caption.bold())
                            .foregroundStyle(a.analysisStatus == "failed" ? Color.red : a.analysisStatus == "done" ? Color.orange : Color.secondary)
                    }
                }
                Spacer()
                if loadingId == a.id { ProgressView() }
            }
        }
        if a.analysisStatus == "done" {
            Button("Vorschläge prüfen") { reviewId = ReviewTarget(id: a.id) }
                .font(.subheadline)
        }
    }

    private func reload() async {
        if let detail = try? await session.fetchTripDetail(tripId: edit.tripId) {
            attachments = detail.attachments ?? []
        }
        await adoptTitleIfNeeded()
    }

    /// Heißt die Reise noch „Neue Reise“: Namensvorschlag der ersten fertigen Analyse übernehmen.
    private func adoptTitleIfNeeded() async {
        guard !titleChecked, edit.tripTitle == TripTitle.placeholder,
              let first = attachments.first(where: { $0.analysisStatus == "done" }) else { return }
        guard let view = try? await session.call({ try await $0.analysis(attachmentId: first.id) }) else { return }
        titleChecked = true
        _ = await TitleAdoption.run(session: session, edit: edit, suggestion: view.suggestedTripTitle)
    }

    /// Mit Token laden, in einen eigenen temporären Ordner legen und mit Quick Look zeigen.
    private func open(_ a: Attachment) async {
        errorText = nil
        loadingId = a.id
        defer { loadingId = nil }
        do {
            let data = try await session.call { try await $0.downloadAttachment(id: a.id) }
            let url = DocumentUploader.tempURL(a.filename)
            try data.write(to: url, options: .completeFileProtection)
            previewURL = url
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func delete(_ a: Attachment) async {
        errorText = nil
        do {
            try await session.call { try await $0.deleteAttachment(id: a.id) }
            await reload()
            await edit.reload()
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

// MARK: - Scanner

/// Dokumentenkamera; liefert die Seiten als PDF in einer temporären Datei (oder nil bei Abbruch).
struct DocumentScanner: UIViewControllerRepresentable {
    let onFinish: (URL?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: (URL?) -> Void
        init(onFinish: @escaping (URL?) -> Void) { self.onFinish = onFinish }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            guard scan.pageCount > 0 else { onFinish(nil); return }
            let first = scan.imageOfPage(at: 0)
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd HH.mm"
            let url = DocumentUploader.tempURL("Scan \(f.string(from: Date())).pdf")
            let renderer = UIGraphicsPDFRenderer(bounds: CGRect(origin: .zero, size: first.size))
            do {
                try renderer.writePDF(to: url) { ctx in
                    for i in 0..<scan.pageCount {
                        let image = scan.imageOfPage(at: i)
                        ctx.beginPage(withBounds: CGRect(origin: .zero, size: image.size), pageInfo: [:])
                        image.draw(in: CGRect(origin: .zero, size: image.size))
                    }
                }
                onFinish(url)
            } catch {
                onFinish(nil)
            }
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onFinish(nil) }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onFinish(nil)
        }
    }
}

// MARK: - Vorschläge prüfen

struct DocReviewView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let attachmentId: String
    let edit: EditContext
    let onDone: () -> Void

    struct Row {
        let proposal: ItemProposal
        var data: [String: JSONValue]
        var apply: Bool
        var edited = false
    }

    @State private var view: AnalysisView?
    @State private var rows: [Row] = []
    @State private var applyCruise = false
    @State private var errorText: String?
    @State private var busy: String?
    @State private var editing: EditingRow?

    struct EditingRow: Identifiable { let id: Int }

    var body: some View {
        NavigationStack {
            Form {
                if let errorText {
                    Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
                if let busy {
                    Section { HStack { ProgressView(); Text(busy) } }
                }
                if let view {
                    content(view)
                } else if errorText == nil {
                    Section { ProgressView() }
                }
            }
            .navigationTitle("Vorschläge prüfen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } }
                if edit.isEditor, view?.status == "done" {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Übernehmen") { Task { await applyNow() } }.disabled(busy != nil)
                    }
                }
            }
            .task { await load() }
            .interactiveDismissDisabled(busy != nil)
            .sheet(item: $editing) { target in
                if target.id < rows.count, let item = ProposalEdit.item(from: rows[target.id].data) {
                    ItemFormView(ctx: edit, item: item, onSubmit: { payload in
                        rows[target.id].data = ProposalEdit.replaceData(original: rows[target.id].data, payload: payload)
                        rows[target.id].edited = true
                        rows[target.id].apply = true
                    }, onSaved: { _ in })
                }
            }
        }
    }

    @ViewBuilder
    private func content(_ v: AnalysisView) -> some View {
        Section {
            if let kind = v.documentKind, !kind.isEmpty { Text(kind).font(.headline) }
            if let summary = v.summary, !summary.isEmpty { Text(summary) }
            if let files = v.files, files.count > 1 {
                Text("Zusammen gelesen: " + files.map(\.filename).joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
            }
            ForEach(Array((v.warnings ?? []).enumerated()), id: \.offset) { _, w in
                Label(w, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.subheadline)
            }
        }
        if v.status != "done" {
            Section {
                Text(DocumentStatus.text(Attachment(id: attachmentId, tripId: nil, itemId: nil, filename: "", mime: nil, size: nil,
                                                    createdAt: nil, analysisStatus: v.status, analysisError: v.attachment?.analysisError))
                     ?? "Keine offenen Vorschläge.")
                    .foregroundStyle(.secondary)
            }
        }
        if v.status == "done" && AIFeatures(status: session.aiStatus, role: edit.isEditor ? "editor" : "viewer").showResearch {
            ResearchSection(attachmentId: attachmentId, analysis: v, edits: rows.contains { $0.edited },
                            canRoute: edit.tripKind == nil || edit.tripKind == "cruise" || !edit.cruises.isEmpty) {
                Task { await load() }
            }
        }
        if let cruise = v.cruise {
            Section {
                cruiseRow(cruise)
            } header: {
                Text("Kreuzfahrt")
            }
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { n, row in
            Section {
                proposalRow(row, index: n)
            }
        }
        if v.status == "done" && edit.isEditor {
            Section {
                Button("Verwerfen (Datei bleibt)") { Task { await dismissAnalysis() } }.disabled(busy != nil)
            }
        }
        if edit.isEditor {
            Section {
                Button("Erneut lesen") { Task { await reanalyze() } }.disabled(busy != nil)
            } footer: {
                Text("Dauert bis zu einer Minute.")
            }
        }
    }

    @ViewBuilder
    private func proposalRow(_ row: Row, index n: Int) -> some View {
        let d = row.data
        let p = row.proposal
        let type = Labels.itemType(DocReviewLogic.text(d, "type") ?? "")
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(type.icon) \(type.label)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if row.edited {
                    Text("bearbeitet").font(.caption.bold()).foregroundStyle(.blue)
                } else {
                    Text(DocReviewLogic.confidenceText(p.confidence)).font(.caption.bold())
                        .foregroundStyle(p.confidence == "low" ? Color.red : p.confidence == "high" ? Color.green : Color.orange)
                }
            }
            Text(DocReviewLogic.text(d, "title") ?? "Ohne Titel").font(.headline)
            if let when = when(d) { Text(when).font(.subheadline) }
            if let loc = DocReviewLogic.text(d, "location") { Text(loc).font(.subheadline).foregroundStyle(.secondary) }
            if let place = placeLine(d) { Text(place).font(.subheadline.bold()) }
            if let cost = d["cost"]?.text { Text("Preis \(cost) \(DocReviewLogic.text(d, "currency") ?? "")").font(.caption) }
            if d["cruiseDayId"]?.text != nil { Text("⚓ Einem Hafentag zugeordnet").font(.caption).foregroundStyle(.secondary) }
            if let m = p.match {
                Text("Aktualisiert: \(m.title ?? "vorhandener Eintrag")").font(.caption.bold()).foregroundStyle(.blue)
                ForEach(Array((m.changes ?? []).enumerated()), id: \.offset) { _, c in
                    Text("· \(c)").font(.caption).foregroundStyle(.secondary)
                }
            }
            if !row.edited {
                ForEach(Array((p.problems ?? []).enumerated()), id: \.offset) { _, problem in
                    Text(problem).font(.caption).foregroundStyle(.red)
                }
                if !(p.problems ?? []).isEmpty {
                    Text("Bitte über „Bearbeiten“ korrigieren.").font(.caption).foregroundStyle(.red)
                }
            }
        }
        if edit.isEditor && view?.status == "done" {
            Toggle(p.match != nil ? "Aktualisieren" : "Übernehmen", isOn: $rows[n].apply)
                .disabled(!row.edited && !(p.problems ?? []).isEmpty)
            Button("Bearbeiten") { editing = EditingRow(id: n) }
        }
    }

    @ViewBuilder
    private func cruiseRow(_ c: CruiseProposal) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("🛳️ \(DocReviewLogic.text(c.data, "shipName") ?? "Schiff")").font(.headline)
            if let cabin = DocReviewLogic.text(c.data, "cabin") { Text("Kabine \(cabin)").font(.subheadline) }
            if case let .array(days)? = c.data["days"] { Text("\(days.count) Tage").font(.subheadline).foregroundStyle(.secondary) }
            if let m = c.match {
                Text("Gehört zur vorhandenen Kreuzfahrt „\(m.shipName ?? "")“: \(c.updatedDays ?? 0) Tage werden ergänzt, \(c.newDays ?? 0) kommen neu dazu.")
                    .font(.caption).foregroundStyle(.blue)
            }
            ForEach(Array((c.problems ?? []).enumerated()), id: \.offset) { _, problem in
                Text(problem).font(.caption).foregroundStyle(.red)
            }
        }
        if edit.isEditor && view?.status == "done" {
            Toggle(c.match != nil ? "Zusammenführen" : "Anlegen", isOn: $applyCruise)
                .disabled(!(c.problems ?? []).isEmpty)
        }
    }

    private func when(_ d: [String: JSONValue]) -> String? {
        guard let start = DocReviewLogic.text(d, "startLocal") else { return nil }
        var text = Fmt.local(start)
        if let end = DocReviewLogic.text(d, "endLocal") {
            text += " → " + (end.prefix(10) == start.prefix(10) && end.count > 10 ? String(end.dropFirst(11).prefix(5)) : Fmt.local(end))
        }
        return text
    }

    private func placeLine(_ d: [String: JSONValue]) -> String? {
        guard case let .object(details)? = d["details"], let type = DocReviewLogic.text(d, "type") else { return nil }
        let item = Item(id: "", tripId: nil, type: type, title: "", startLocal: "", startTz: nil, endLocal: nil, endTz: nil,
                        location: nil, confirmation: nil, provider: nil, notes: nil, cruiseDayId: nil, cost: nil, currency: nil,
                        paymentStatus: nil, paidAmount: nil, dueDate: nil, details: StringMap(raw: details), infos: nil)
        let line = Labels.placeLine(item)
        return line.isEmpty ? nil : line
    }

    private func load() async {
        errorText = nil
        do {
            let v = try await session.call { try await $0.analysis(attachmentId: attachmentId) }
            rows = (v.items ?? []).map { Row(proposal: $0, data: $0.data, apply: DocReviewLogic.defaultApply($0)) }
            applyCruise = v.cruise.map(DocReviewLogic.defaultApply) ?? false
            view = v
            if v.status == "done" { _ = await TitleAdoption.run(session: session, edit: edit, suggestion: v.suggestedTripTitle) }
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func applyNow() async {
        guard let v = view else { return }
        let items = rows.map { row in
            (proposal: ItemProposal(index: row.proposal.index, data: row.data, confidence: row.proposal.confidence,
                                    match: row.proposal.match, problems: row.proposal.problems), apply: row.apply)
        }
        let body = DocReviewLogic.applyBody(items: items, cruise: v.cruise.map { (proposal: $0, apply: applyCruise) })
        await run("Wird übernommen …") {
            try await session.call { try await $0.applyAnalysis(attachmentId: attachmentId, body) }
            await edit.reload()
            onDone()
            dismiss()
        }
    }

    private func dismissAnalysis() async {
        await run("Wird verworfen …") {
            try await session.call { try await $0.dismissAnalysis(attachmentId: attachmentId) }
            onDone()
            dismiss()
        }
    }

    private func reanalyze() async {
        await run("Wird erneut gelesen … (bis zu einer Minute)") {
            try await session.call { try await $0.reanalyze(attachmentId: attachmentId) }
            await load()
            onDone()
        }
    }

    private func run(_ label: String, _ work: () async throws -> Void) async {
        errorText = nil
        busy = label
        defer { busy = nil }
        do { try await work() } catch { errorText = SaveError.text(error) }
    }
}

// MARK: - Recherche im Internet

private struct ResearchSection: View {
    @Environment(AppSession.self) private var session
    let attachmentId: String
    let analysis: AnalysisView
    /// Es gibt bearbeitete Vorschläge (gehen beim Übernehmen der Recherche verloren).
    let edits: Bool
    let canRoute: Bool
    let onAccepted: () -> Void

    @State private var research: Research?
    @State private var loaded = false
    @State private var url = ""
    @State private var picked: Set<String> = []
    @State private var busy = false
    @State private var errorText: String?
    @State private var confirmAccept = false

    var body: some View {
        Section {
            if !loaded {
                ProgressView()
            } else if let research {
                stateView(research)
            } else {
                Text("Die KI sucht im Internet nach dem, was fehlt (Verbindungen, Zeiten, Telefonnummern, bei Kreuzfahrten auch den Reiseverlauf). Du siehst die Funde mit Quelle zuerst hier und entscheidest, was übernommen wird.")
                    .font(.subheadline).foregroundStyle(.secondary)
                TextField("Link zur Reise (optional), https://…", text: $url)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                if canRoute {
                    Button("🧭 Reiseverlauf suchen") { Task { await start("route") } }.disabled(busy)
                }
                Button("Lücken füllen") { Task { await start("gaps") } }.disabled(busy)
                Text("Mit Link liest die KI genau diese Seite. Dafür gehen Schiff, Orte und Reisedaten aus der Analyse (und dein Link) an die Websuche des eingestellten KI-Anbieters. Das Dokument selbst wird nicht erneut gesendet.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let errorText { Text(errorText).font(.footnote).foregroundStyle(.red) }
        } header: {
            Text("Im Internet ergänzen (optional)")
        } footer: {
            Text("Funde aus dem Internet sind mit „bitte prüfen“ markiert. Nichts wird ohne „Übernehmen“ gespeichert.")
        }
        .task { await load() }
        .task(id: research?.status) {
            while Polling.shouldContinue(research?.status) && !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if Task.isCancelled { break }
                if let r = try? await session.call({ try await $0.research(attachmentId: attachmentId) }).research,
                   !Polling.shouldContinue(r.status) {
                    research = r
                    picked = Set(ResearchLogic.open(r).map(\.id))
                }
            }
        }
        .confirmationDialog("Deine Änderungen an den Vorschlägen gehen dabei verloren, weil die Vorschläge neu aufgebaut werden.",
                            isPresented: $confirmAccept, titleVisibility: .visible) {
            Button("Trotzdem übernehmen") { Task { await accept() } }
        }
    }

    @ViewBuilder
    private func stateView(_ r: Research) -> some View {
        switch r.status {
        case "pending":
            HStack {
                ProgressView()
                Text(r.mode == "route" ? "Sucht den Reiseverlauf … das dauert ein bis zwei Minuten." : "Recherchiert … das dauert ein bis zwei Minuten.")
                    .font(.subheadline)
            }
        case "failed":
            Text(r.error ?? "Die Recherche ist fehlgeschlagen.").foregroundStyle(.red)
            if let d = r.diagnostics { DiagnosticsView(d: d) }
            Button("Erneut versuchen") { Task { await start(r.mode ?? "gaps") } }.disabled(busy)
            Button("Schließen") { Task { await discard() } }.disabled(busy)
        default:
            let open = ResearchLogic.open(r)
            if let s = r.summary, !s.isEmpty { Text(s) }
            if open.isEmpty {
                Text((r.suggestions ?? []).isEmpty ? "Es wurden keine verwertbaren Ergänzungen gefunden. Mit einem Link zur Reise klappt es oft besser."
                                                    : "Alle Funde sind übernommen.")
                    .foregroundStyle(.secondary)
            }
            if let d = r.diagnostics { DiagnosticsView(d: d) }
            ForEach(open) { s in suggestionRow(s) }
            Text("Aus dem Internet, nicht aus deinen Unterlagen. Zeiten und Nummern bitte kurz gegen die Quelle prüfen.")
                .font(.caption).foregroundStyle(.secondary)
            if !open.isEmpty {
                Button("Ausgewählte übernehmen (\(picked.count))") {
                    if edits { confirmAccept = true } else { Task { await accept() } }
                }
                .disabled(busy || picked.isEmpty)
            }
            Button(open.isEmpty ? "Schließen" : "Verwerfen", role: .destructive) { Task { await discard() } }.disabled(busy)
        }
    }

    @ViewBuilder
    private func suggestionRow(_ s: ResearchSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(get: { picked.contains(s.id) }, set: { if $0 { picked.insert(s.id) } else { picked.remove(s.id) } })) {
                VStack(alignment: .leading) {
                    Text(s.title).bold()
                    Text(targetLabel(s)).font(.caption).foregroundStyle(.secondary)
                }
            }
            if let note = s.note { Text(note).font(.subheadline) }
            ForEach(Array((s.route?.days ?? []).enumerated()), id: \.offset) { _, d in
                Text("\(Fmt.local(d.date)) · \(d.kind == "sea" ? "Seetag" : [d.portName, d.country].compactMap { $0 }.joined(separator: ", "))\([d.arrival, d.departure].compactMap { $0 }.isEmpty ? "" : " · " + [d.arrival, d.departure].compactMap { $0 }.joined(separator: " – "))")
                    .font(.caption)
            }
            ForEach(Array((s.fields ?? []).enumerated()), id: \.offset) { _, f in
                Text("\(ResearchLogic.fieldLabels[f.field] ?? f.field): \(f.value)").font(.caption)
            }
            ForEach(Array((s.details ?? []).enumerated()), id: \.offset) { _, d in
                Text("\(d.key): \(d.value)").font(.caption)
            }
            ForEach(Array((s.infos ?? []).enumerated()), id: \.offset) { _, i in
                Text("\(i.label): \(i.value) · bitte prüfen").font(.caption).foregroundStyle(.orange)
            }
            ForEach(Array((s.sources ?? []).enumerated()), id: \.offset) { _, src in
                if let link = URL(string: src.url) {
                    Link("Quelle: \(link.host() ?? src.url)", destination: link).font(.caption)
                }
            }
        }
    }

    private func targetLabel(_ s: ResearchSuggestion) -> String {
        guard let t = s.target else { return "" }
        switch t.kind {
        case "item":
            let items = analysis.items ?? []
            return t.index < items.count ? (DocReviewLogic.text(items[t.index].data, "title") ?? "Eintrag") : "Eintrag"
        case "day":
            return "Hafentag"
        default:
            return "Kreuzfahrt \(analysis.cruise.flatMap { DocReviewLogic.text($0.data, "shipName") } ?? s.route?.shipName ?? "")"
        }
    }

    private func load() async {
        research = try? await session.call({ try await $0.research(attachmentId: attachmentId) }).research
        if let r = research { picked = Set(ResearchLogic.open(r).map(\.id)) }
        loaded = true
    }

    private func start(_ mode: String) async {
        let checked = ResearchLogic.validURL(url)
        if let e = checked.error { errorText = e; return }
        errorText = nil
        busy = true
        defer { busy = false }
        do {
            research = try await session.call { try await $0.startResearch(attachmentId: attachmentId, mode: mode, url: checked.url) }.research
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func accept() async {
        errorText = nil
        busy = true
        defer { busy = false }
        do {
            try await session.call { try await $0.acceptResearch(attachmentId: attachmentId, ids: Array(picked)) }
            await load()
            onAccepted()
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func discard() async {
        busy = true
        defer { busy = false }
        do {
            try await session.call { try await $0.dismissResearch(attachmentId: attachmentId) }
            research = nil
            picked = []
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

/// „Was wurde gesucht?“
private struct DiagnosticsView: View {
    let d: ResearchDiagnostics
    @State private var open = false

    var body: some View {
        DisclosureGroup("Was wurde gesucht?", isExpanded: $open) {
            Text("Suchanfragen: " + ((d.queries ?? []).isEmpty ? "keine" : (d.queries ?? []).map { "„\($0)“" }.joined(separator: " · ")))
                .font(.caption)
            if let f = d.fetched, !f.isEmpty { Text("Gelesene Seiten: " + f.joined(separator: ", ")).font(.caption) }
            Text("Gefundene Quellen: \(d.sourcesFound ?? 0)"
                 + ((d.droppedNoSource ?? 0) > 0 ? " · \(d.droppedNoSource ?? 0) Fund ohne prüfbare Quelle verworfen" : "")
                 + ((d.droppedInvalid ?? 0) > 0 ? " · \(d.droppedInvalid ?? 0) unbrauchbar" : ""))
                .font(.caption)
            if let n = d.notes, !n.isEmpty { Text(n).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

// ENDE DocumentsView.swift
