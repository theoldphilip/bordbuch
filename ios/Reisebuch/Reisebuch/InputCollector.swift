//
//  InputCollector.swift
//  Reisebuch
//
//  Dokumente sammeln und hochladen (Auftrag 0.8.0, wie InputCollector.tsx und aiImport.ts): Dateien, Fotos, Scans und eingefügter
//  Text (als Text.txt) in eine Liste; bei mehreren der Schalter „Gehören zu einer Buchung (zusammen auswerten)“. Hochladen einzeln mit
//  ?background=1 oder zusammen über /attachments + /documents/group?background=1. Genutzt in „Dokumente“ und bei „Neue Reise“.
//

import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// Eine gesammelte Datei als temporäre Kopie.
struct PendingFile: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    let filename: String
    let label: String
}

enum DocumentUploader {
    /// Lädt hoch und gibt einen Text für Philip zurück (bzw. Fehler je Datei). Temporäre Dateien werden gelöscht.
    static func upload(session: AppSession, tripId: String, files: [PendingFile], grouped: Bool) async -> (message: String?, errors: [String]) {
        defer { for f in files { try? FileManager.default.removeItem(at: f.url) } }
        var errors: [String] = []
        if grouped && files.count >= 2 {
            var ids: [String] = []
            for f in files {
                do {
                    ids.append(try await session.call { try await $0.uploadAttachment(tripId: tripId, file: f.url, filename: f.filename) }.id)
                } catch {
                    errors.append("\(f.label): \(SaveError.text(error))")
                }
            }
            guard !ids.isEmpty else { return (nil, errors) }
            do {
                if ids.count > 1 {
                    _ = try await session.call { try await $0.analyzeGroup(tripId: tripId, attachmentIds: ids) }
                    return (Upload.message(.background), errors)
                }
                try await session.call { try await $0.reanalyze(attachmentId: ids[0]) }
                return ("Gelesen. Die Vorschläge stehen unter „Dokumente“.", errors)
            } catch {
                errors.append("Zusammengefasste Unterlage: \(SaveError.text(error))")
                return (nil, errors)
            }
        }
        var outcomes: [Upload.Outcome] = []
        for f in files {
            do {
                outcomes.append(try await session.call { try await $0.uploadDocument(tripId: tripId, file: f.url, filename: f.filename) })
            } catch {
                errors.append("\(f.label): \(SaveError.text(error))")
            }
        }
        guard !outcomes.isEmpty else { return (nil, errors) }
        return (Upload.message(outcomes.contains(.background) ? .background : .saved), errors)
    }

    static func tempURL(_ name: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(Upload.safeFilename(name))
    }
}

/// Liste der gesammelten Eingaben mit Hinzufügen und dem Schalter „zusammen auswerten“.
struct InputCollectorSection: View {
    @Binding var files: [PendingFile]
    @Binding var grouped: Bool
    var disabled = false

    @State private var showImporter = false
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showScanner = false
    @State private var showText = false
    @State private var text = ""
    @State private var problem: String?

    var body: some View {
        Section {
            ForEach(files) { f in
                HStack {
                    Image(systemName: icon(f.filename))
                    Text(f.label).lineLimit(1)
                    Spacer()
                    Text(ByteCountFormatter.string(fromByteCount: Int64(Upload.fileSize(f.url)), countStyle: .file))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .onDelete { idx in
                for i in idx { try? FileManager.default.removeItem(at: files[i].url) }
                files.remove(atOffsets: idx)
            }
            Menu {
                Button("Aus Dateien", systemImage: "folder") { showImporter = true }
                Button("Aus Fotos", systemImage: "photo") { showPhotos = true }
                if VNDocumentCameraViewController.isSupported {
                    Button("Scannen", systemImage: "doc.viewfinder") { showScanner = true }
                }
                Button("Text einfügen", systemImage: "text.alignleft") { showText = true }
            } label: {
                Label(files.isEmpty ? "Dokumente hinzufügen" : "Weitere hinzufügen", systemImage: "plus")
            }
            .disabled(disabled)
            if files.count > 1 {
                Toggle(isOn: $grouped) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Gehören zu einer Buchung (zusammen auswerten)")
                        Text("z. B. mehrere Screenshots derselben Buchung. Sonst wird jede Datei einzeln gelesen.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .disabled(disabled)
            }
            if let problem { Text(problem).font(.footnote).foregroundStyle(.red) }
        } header: {
            Text("Unterlagen")
        } footer: {
            if !files.isEmpty { Text("Zum Entfernen nach links wischen.") }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .image, .plainText, .item],
                      allowsMultipleSelection: true) { result in
            if case let .success(urls) = result { addFiles(urls) }
        }
        .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 10, matching: .images)
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addPhotos(items) }
        }
        .fullScreenCover(isPresented: $showScanner) {
            DocumentScanner { url in
                showScanner = false
                if let url { append(PendingFile(url: url, filename: url.lastPathComponent, label: url.lastPathComponent)) }
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showText) {
            NavigationStack {
                Form {
                    Section {
                        TextField("z. B. kopierte Buchungsmail", text: $text, axis: .vertical).lineLimit(8...20)
                    } footer: {
                        Text("Wird als „Text.txt“ hochgeladen.")
                    }
                }
                .navigationTitle("Text einfügen")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { showText = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Hinzufügen") { addText() }
                            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
    }

    private func icon(_ name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "pdf": return "doc.richtext"
        case "jpg", "jpeg", "png", "heic": return "photo"
        case "txt": return "text.alignleft"
        default: return "doc"
        }
    }

    private func append(_ f: PendingFile) {
        problem = nil
        if Upload.fileSize(f.url) > Upload.maxBytes {
            problem = "„\(f.label)“ ist größer als 25 MB."
            try? FileManager.default.removeItem(at: f.url)
            return
        }
        let wasSingle = files.count <= 1
        files.append(f)
        if wasSingle && files.count > 1 { grouped = Upload.defaultGrouped(filenames: files.map(\.filename)) }
    }

    private func addFiles(_ urls: [URL]) {
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let copy = DocumentUploader.tempURL(url.lastPathComponent)
            if (try? FileManager.default.copyItem(at: url, to: copy)) != nil {
                append(PendingFile(url: copy, filename: copy.lastPathComponent, label: url.lastPathComponent))
            } else {
                problem = "„\(url.lastPathComponent)“ ließ sich nicht lesen."
            }
        }
    }

    /// Fotos als JPEG (HEIC kann der Server nicht lesen).
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        photoItems = []
        let start = files.filter { $0.filename.hasPrefix("Foto") }.count
        for (n, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.85) else {
                problem = "Ein Foto ließ sich nicht lesen."
                continue
            }
            let name = "Foto-\(start + n + 1).jpg"
            let url = DocumentUploader.tempURL(name)
            if (try? jpeg.write(to: url)) != nil { append(PendingFile(url: url, filename: name, label: name)) }
        }
    }

    private func addText() {
        let url = DocumentUploader.tempURL("Text.txt")
        if (try? Data(text.utf8).write(to: url)) != nil {
            append(PendingFile(url: url, filename: "Text.txt", label: "Text (\(text.count) Zeichen)"))
        }
        text = ""
        showText = false
    }
}

/// Blatt „Dokumente hinzufügen“ in einer Reise.
struct AddDocumentsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let tripId: String
    let onDone: (String?) -> Void

    @State private var files: [PendingFile] = []
    @State private var grouped = false
    @State private var busy = false
    @State private var errors: [String] = []

    var body: some View {
        NavigationStack {
            Form {
                if !errors.isEmpty {
                    Section { ForEach(errors, id: \.self) { Text($0).foregroundStyle(.red) } }
                }
                InputCollectorSection(files: $files, grouped: $grouped, disabled: busy)
                Section {
                    Text("Die Dokumente werden zur Analyse an den eingestellten KI-Anbieter gesendet.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Dokumente hinzufügen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") {
                        for f in files { try? FileManager.default.removeItem(at: f.url) }
                        dismiss()
                    }
                    .disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else {
                        Button("Hochladen") { Task { await upload() } }.disabled(files.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private func upload() async {
        busy = true
        defer { busy = false }
        let result = await DocumentUploader.upload(session: session, tripId: tripId, files: files, grouped: grouped)
        files = []
        errors = result.errors
        if errors.isEmpty {
            onDone(result.message)
            dismiss()
        } else {
            onDone(result.message)
        }
    }
}

// ENDE InputCollector.swift
