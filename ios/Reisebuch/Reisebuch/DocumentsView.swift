//
//  DocumentsView.swift
//  Reisebuch
//
//  Dokumente einer Reise (Auftrag 0.7.0): Liste mit Status, Ansehen mit Quick Look, Hinzufügen aus Dateien, Fotos oder Scanner
//  (hochgeladen mit ?background=1, die KI liest im Hintergrund und meldet sich per Mitteilung), Löschen, Vorschläge prüfen und
//  übernehmen. Web-Recherche und „zusammen auswerten“ bleiben in der Web-App.
//

import PhotosUI
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

// MARK: - Zeile im Ablauf

/// Eingang zu den Dokumenten oben im Ablauf.
struct DocumentsLinkSection: View {
    let attachments: [Attachment]
    let edit: EditContext
    let itemTitles: [String: String]

    var body: some View {
        let visible = DocumentStatus.visible(attachments)
        let review = visible.filter { $0.analysisStatus == "done" }.count
        let pending = visible.filter { $0.analysisStatus == "pending" }.count
        Section {
            NavigationLink {
                DocumentsView(edit: edit, itemTitles: itemTitles, initial: attachments)
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Label(visible.isEmpty ? "Dokumente" : "Dokumente (\(visible.count))", systemImage: "doc.on.doc")
                    if review > 0 || pending > 0 {
                        Text([review > 0 ? (review == 1 ? "1 mit Vorschlägen zum Prüfen" : "\(review) mit Vorschlägen zum Prüfen") : nil,
                              pending > 0 ? "\(pending) wird gelesen" : nil].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(review > 0 ? Color.orange : Color.secondary)
                    }
                }
            }
        }
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
    @State private var uploading = false
    @State private var previewURL: URL?
    @State private var loadingId: String?
    @State private var reviewId: ReviewTarget?
    @State private var showImporter = false
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showScanner = false
    @State private var toDelete: Attachment?

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
            if uploading {
                Section { HStack { ProgressView(); Text("Wird hochgeladen …") } }
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
        .navigationTitle("Dokumente")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if edit.canEdit {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Aus Dateien", systemImage: "folder") { showImporter = true }
                        Button("Aus Fotos", systemImage: "photo") { showPhotos = true }
                        if VNDocumentCameraViewController.isSupported {
                            Button("Scannen", systemImage: "doc.viewfinder") { showScanner = true }
                        }
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Dokument hinzufügen")
                    .disabled(uploading)
                }
            }
        }
        .refreshable { await reload() }
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
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .image, .plainText, .item],
                      allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { Task { await uploadFiles(urls) } }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 10, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await uploadPhotos(items) }
        }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { url in
                showScanner = false
                if let url { Task { await upload([(url, url.lastPathComponent)], cleanup: true) } }
            }
            .ignoresSafeArea()
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
    }

    /// Mit Token laden, in einen eigenen temporären Ordner legen und mit Quick Look zeigen.
    private func open(_ a: Attachment) async {
        errorText = nil
        loadingId = a.id
        defer { loadingId = nil }
        do {
            let data = try await session.call { try await $0.downloadAttachment(id: a.id) }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ansehen-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(Upload.safeFilename(a.filename))
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

    private func uploadFiles(_ urls: [URL]) async {
        var files: [(URL, String)] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            // In den eigenen temporären Ordner kopieren (der Zugriff gilt nur hier).
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(url.lastPathComponent)")
            do {
                try FileManager.default.copyItem(at: url, to: copy)
                files.append((copy, url.lastPathComponent))
            } catch {
                errorText = "„\(url.lastPathComponent)“ ließ sich nicht lesen."
            }
        }
        await upload(files, cleanup: true)
    }

    /// Fotos als JPEG (HEIC kann der Server nicht lesen).
    private func uploadPhotos(_ items: [PhotosPickerItem]) async {
        photoItems = []
        var files: [(URL, String)] = []
        for (n, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.85) else {
                errorText = "Ein Foto ließ sich nicht lesen."
                continue
            }
            let name = items.count == 1 ? "Foto.jpg" : "Foto-\(n + 1).jpg"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString)-\(name)")
            if (try? jpeg.write(to: url)) != nil { files.append((url, name)) }
        }
        await upload(files, cleanup: true)
    }

    private func upload(_ files: [(URL, String)], cleanup: Bool) async {
        guard !files.isEmpty else { return }
        errorText = nil
        message = nil
        uploading = true
        defer { uploading = false }
        var outcomes: [Upload.Outcome] = []
        for (url, name) in files {
            defer { if cleanup { try? FileManager.default.removeItem(at: url) } }
            do {
                outcomes.append(try await session.call {
                    try await $0.uploadDocument(tripId: edit.tripId, file: url, filename: name)
                })
            } catch {
                errorText = "„\(name)“: \(SaveError.text(error))"
            }
        }
        if !outcomes.isEmpty {
            message = Upload.message(outcomes.contains(.background) ? .background : .saved)
        }
        await reload()
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
            let bounds = CGRect(origin: .zero, size: first.size)
            let f = DateFormatter()
            f.dateFormat = "yyyy-MM-dd HH.mm"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("Scan \(f.string(from: Date())).pdf")
            let renderer = UIGraphicsPDFRenderer(bounds: bounds)
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

    @State private var view: AnalysisView?
    @State private var apply: [Bool] = []
    @State private var applyCruise = false
    @State private var errorText: String?
    @State private var busy: String?

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
                Text(DocumentStatus.text(v.attachment ?? Attachment(id: attachmentId, tripId: nil, itemId: nil, filename: "",
                                                                     mime: nil, size: nil, createdAt: nil,
                                                                     analysisStatus: v.status, analysisError: nil))
                     ?? "Keine offenen Vorschläge.")
                    .foregroundStyle(.secondary)
            }
        }
        if let cruise = v.cruise {
            Section {
                cruiseRow(cruise)
            } header: {
                Text("Kreuzfahrt")
            }
        }
        ForEach(Array((v.items ?? []).enumerated()), id: \.offset) { n, p in
            Section {
                proposalRow(p, index: n)
            }
        }
        if v.status == "done" && edit.isEditor {
            Section {
                Button("Verwerfen (Datei bleibt)") { Task { await dismissAnalysis() } }.disabled(busy != nil)
            } footer: {
                Text("Ändern nach dem Übernehmen im Eintrag. Web-Recherche und „zusammen auswerten“ gibt es in der Web-App.")
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
    private func proposalRow(_ p: ItemProposal, index n: Int) -> some View {
        let d = p.data
        let type = Labels.itemType(DocReviewLogic.text(d, "type") ?? "")
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(type.icon) \(type.label)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Text(DocReviewLogic.confidenceText(p.confidence)).font(.caption.bold())
                    .foregroundStyle(p.confidence == "low" ? Color.red : p.confidence == "high" ? Color.green : Color.orange)
            }
            Text(DocReviewLogic.text(d, "title") ?? "Ohne Titel").font(.headline)
            if let when = when(d) { Text(when).font(.subheadline) }
            if let loc = DocReviewLogic.text(d, "location") { Text(loc).font(.subheadline).foregroundStyle(.secondary) }
            if let place = placeLine(d) { Text(place).font(.subheadline.bold()) }
            if let cost = d["cost"]?.text { Text("Preis \(cost) \(DocReviewLogic.text(d, "currency") ?? "")").font(.caption) }
            if let m = p.match {
                Text("Aktualisiert: \(m.title ?? "vorhandener Eintrag")").font(.caption.bold()).foregroundStyle(.blue)
                ForEach(Array((m.changes ?? []).enumerated()), id: \.offset) { _, c in
                    Text("· \(c)").font(.caption).foregroundStyle(.secondary)
                }
            }
            ForEach(Array((p.problems ?? []).enumerated()), id: \.offset) { _, problem in
                Text(problem).font(.caption).foregroundStyle(.red)
            }
        }
        if edit.isEditor && n < apply.count {
            Toggle(p.match != nil ? "Aktualisieren" : "Übernehmen", isOn: $apply[n])
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
        if edit.isEditor {
            Toggle(c.match != nil ? "Zusammenführen" : "Anlegen", isOn: $applyCruise)
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
            apply = (v.items ?? []).map(DocReviewLogic.defaultApply)
            applyCruise = v.cruise.map(DocReviewLogic.defaultApply) ?? false
            view = v
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func applyNow() async {
        guard let v = view else { return }
        let items = (v.items ?? []).enumerated().map { (proposal: $0.element, apply: $0.offset < apply.count && apply[$0.offset]) }
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

// ENDE DocumentsView.swift
