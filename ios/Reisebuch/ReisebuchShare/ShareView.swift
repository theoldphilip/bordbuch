//
//  ShareView.swift
//  ReisebuchShare
//
//  Oberfläche und Ablauf der Teilen-Erweiterung: Dateien aus dem Teilen-Menü einsammeln (einzeln in temporäre Dateien, nichts
//  doppelt im Speicher), Reise wählen oder neu anlegen, hochladen, Ergebnis zeigen, schließen.
//

import Observation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Eine geteilte Datei, bereits als temporäre Datei abgelegt.
struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
    let filename: String
    var size: Int { Upload.fileSize(url) }
}

@MainActor
@Observable
final class ShareModel {
    enum Phase: Equatable {
        case loading
        case needsLogin
        case offline
        case ready
        case uploading
        case done(String)
    }

    private weak var context: NSExtensionContext?
    var phase: Phase = .loading
    var trips: [TripSummary] = []
    var selectedTripId: String?
    var newTripTitle = ""
    var files: [SharedFile] = []
    var errorText: String?
    var creatingTrip = false
    /// Mehrere Dateien als eine Unterlage auswerten (Vorbelegung an bei mehreren Bildern).
    var grouped = false

    init(context: NSExtensionContext?) {
        self.context = context
    }

    private var client: APIClient? {
        guard let server = SharedStore.serverAddress, let base = APIClient.normalizedBaseURL(server),
              let token = Keychain.readToken() else { return nil }
        return APIClient(baseURL: base, token: token)
    }

    // MARK: Start

    func start() async {
        await collectFiles()
        grouped = Upload.defaultGrouped(filenames: files.map(\.filename))
        await loadTrips()
    }

    func loadTrips() async {
        errorText = nil
        guard let client else { phase = .needsLogin; return }
        phase = .loading
        do {
            let all = try await client.tripsRaw().trips
            trips = all.filter { $0.role == "owner" || $0.role == "editor" }
            if selectedTripId == nil { selectedTripId = upcoming.first?.id }
            phase = .ready
        } catch APIError.unreachable {
            phase = .offline
        } catch APIError.unauthorized {
            phase = .needsLogin
        } catch {
            errorText = error.localizedDescription
            phase = .ready
        }
    }

    private var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private func isPast(_ t: TripSummary) -> Bool {
        guard let end = t.effectiveEndDate ?? t.effectiveStartDate else { return false }
        return String(end.prefix(10)) < today
    }

    var upcoming: [TripSummary] {
        trips.filter { !isPast($0) }.sorted { ($0.effectiveStartDate ?? "9999") < ($1.effectiveStartDate ?? "9999") }
    }

    var past: [TripSummary] {
        trips.filter(isPast).sorted { ($0.effectiveEndDate ?? "") > ($1.effectiveEndDate ?? "") }
    }

    // MARK: Dateien einsammeln

    private func collectFiles() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var images = 0
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
               !provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                images += 1
                guard images <= 10 else { errorText = "Höchstens 10 Bilder auf einmal."; continue }
                if let f = await loadImage(provider) { files.append(f) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                if let f = await loadFile(provider, type: .pdf) { files.append(f) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
                        || provider.hasItemConformingToTypeIdentifier(UTType.data.identifier)
                        && !provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let f = await loadFile(provider, type: .data) { files.append(f) }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let f = await loadText(provider) { files.append(f) }
            }
        }
        for f in files where f.size > Upload.maxBytes {
            errorText = "„\(f.filename)“ ist größer als 25 MB und wird nicht hochgeladen."
        }
        files.removeAll { $0.size > Upload.maxBytes }
    }

    private nonisolated static func tempURL(_ name: String) -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(name)
    }

    /// Datei als Kopie ablegen (die übergebene URL gilt nur im Rückruf).
    private func loadFile(_ provider: NSItemProvider, type: UTType) async -> SharedFile? {
        let suggested = provider.suggestedName
        return await withCheckedContinuation { (c: CheckedContinuation<SharedFile?, Never>) in
            _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, _ in
                guard let url else { c.resume(returning: nil); return }
                var name = url.lastPathComponent
                if let suggested, !suggested.isEmpty {
                    name = (suggested as NSString).pathExtension.isEmpty && !url.pathExtension.isEmpty
                        ? "\(suggested).\(url.pathExtension)" : suggested
                }
                let target = Self.tempURL(Upload.safeFilename(name))
                do {
                    try FileManager.default.copyItem(at: url, to: target)
                    c.resume(returning: SharedFile(url: target, filename: target.lastPathComponent))
                } catch {
                    c.resume(returning: nil)
                }
            }
        }
    }

    /// Bilder als JPEG (HEIC kann der Server nicht lesen); PNG und JPEG bleiben, wie sie sind.
    private func loadImage(_ provider: NSItemProvider) async -> SharedFile? {
        guard let file = await loadFile(provider, type: .image) else { return nil }
        let ext = file.url.pathExtension.lowercased()
        if ["jpg", "jpeg", "png"].contains(ext) { return file }
        defer { try? FileManager.default.removeItem(at: file.url) }
        guard let image = UIImage(contentsOfFile: file.url.path), let jpeg = image.jpegData(compressionQuality: 0.85) else { return nil }
        let name = ((file.filename as NSString).deletingPathExtension) + ".jpg"
        let target = Self.tempURL(name)
        guard (try? jpeg.write(to: target)) != nil else { return nil }
        return SharedFile(url: target, filename: name)
    }

    /// Text wird als „Text.txt“ hochgeladen.
    private func loadText(_ provider: NSItemProvider) async -> SharedFile? {
        await withCheckedContinuation { (c: CheckedContinuation<SharedFile?, Never>) in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                let text: String?
                if let s = item as? String { text = s }
                else if let d = item as? Data { text = String(data: d, encoding: .utf8) }
                else if let u = item as? URL { text = try? String(contentsOf: u, encoding: .utf8) }
                else { text = nil }
                guard let text, !text.isEmpty else { c.resume(returning: nil); return }
                let target = Self.tempURL("Text.txt")
                guard (try? Data(text.utf8).write(to: target)) != nil else { c.resume(returning: nil); return }
                c.resume(returning: SharedFile(url: target, filename: "Text.txt"))
            }
        }
    }

    // MARK: Aktionen

    func createTrip() async {
        let title = newTripTitle.trimmingCharacters(in: .whitespaces)
        guard !title.isEmpty, let client else { return }
        errorText = nil
        creatingTrip = true
        defer { creatingTrip = false }
        do {
            let detail = try await client.createTrip(["title": .string(title), "kind": .string("city")])
            if let t = detail.trip {
                trips.insert(TripSummary(id: t.id, title: t.title, kind: t.kind, startDate: t.startDate, endDate: t.endDate,
                                         effectiveStartDate: t.startDate, effectiveEndDate: t.endDate, role: "owner",
                                         ships: [], memberCount: 1, updatedAt: nil), at: 0)
                selectedTripId = t.id
                newTripTitle = ""
            }
        } catch APIError.unreachable {
            errorText = "Server nicht erreichbar (VPN an?)."
        } catch {
            errorText = error.localizedDescription
        }
    }

    func upload() async {
        guard let tripId = selectedTripId, let client, !files.isEmpty else { return }
        errorText = nil
        phase = .uploading
        var outcomes: [Upload.Outcome] = []
        var remaining: [SharedFile] = []
        if grouped && files.count >= 2 {
            // Zusammen: erst alle speichern, dann als eine Unterlage auswerten (erste führt).
            var ids: [String] = []
            for f in files {
                do {
                    ids.append(try await client.uploadAttachment(tripId: tripId, file: f.url, filename: f.filename).id)
                    try? FileManager.default.removeItem(at: f.url)
                } catch APIError.unreachable {
                    remaining.append(f)
                    errorText = "Server nicht erreichbar (VPN an?)."
                } catch {
                    remaining.append(f)
                    errorText = "„\(f.filename)“: \(error.localizedDescription)"
                }
            }
            if ids.count > 1 {
                do { outcomes.append(try await client.analyzeGroup(tripId: tripId, attachmentIds: ids)) } catch {
                    errorText = "Zusammen auswerten: \(error.localizedDescription)"
                }
            } else if let id = ids.first {
                // Nur eine angekommen: einzeln lesen lassen.
                _ = try? await client.reanalyze(attachmentId: id)
                outcomes.append(.saved)
            }
            files = remaining
            finishUpload(outcomes: outcomes, remaining: remaining)
            return
        }
        for f in files {
            do {
                outcomes.append(try await client.uploadDocument(tripId: tripId, file: f.url, filename: f.filename))
                try? FileManager.default.removeItem(at: f.url)
            } catch APIError.unreachable {
                remaining.append(f)
                errorText = "Server nicht erreichbar (VPN an?)."
            } catch {
                remaining.append(f)
                errorText = "„\(f.filename)“: \(error.localizedDescription)"
            }
        }
        files = remaining
        finishUpload(outcomes: outcomes, remaining: remaining)
    }

    private func finishUpload(outcomes: [Upload.Outcome], remaining: [SharedFile]) {
        if remaining.isEmpty && errorText == nil {
            let text = outcomes.contains(.background) ? "Wird gelesen, du bekommst eine Mitteilung." : "Gespeichert."
            phase = .done(text)
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                finish()
            }
        } else {
            // Nichts verloren: die übrigen Dateien bleiben, die Erweiterung bleibt offen.
            phase = .ready
        }
    }

    func cancel() {
        for f in files { try? FileManager.default.removeItem(at: f.url) }
        context?.cancelRequest(withError: NSError(domain: "de.theoldphilip.Reisebuch.ReisebuchShare", code: 0))
    }

    private func finish() {
        context?.completeRequest(returningItems: [], completionHandler: nil)
    }
}

struct ShareView: View {
    @Bindable var model: ShareModel
    @State private var showPast = false

    var body: some View {
        NavigationStack {
            Form {
                if let error = model.errorText {
                    Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
                switch model.phase {
                case .loading:
                    Section { ProgressView() }
                case .needsLogin:
                    Section { Text("Bitte zuerst in der App anmelden.") }
                case .offline:
                    Section {
                        Text("Server nicht erreichbar (VPN an?).")
                        Button("Erneut versuchen") { Task { await model.loadTrips() } }
                    }
                case let .done(text):
                    Section { Label(text, systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                case .ready, .uploading:
                    filesSection
                    tripsSection
                }
            }
            .navigationTitle("Reisebuch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { model.cancel() } }
                ToolbarItem(placement: .confirmationAction) {
                    if model.phase == .uploading {
                        ProgressView()
                    } else if model.phase == .ready {
                        Button("Hochladen") { Task { await model.upload() } }
                            .disabled(model.selectedTripId == nil || model.files.isEmpty)
                    }
                }
            }
        }
    }

    private var filesSection: some View {
        Section("Dateien") {
            if model.files.isEmpty {
                Text("Nichts Passendes zum Hochladen gefunden.").foregroundStyle(.secondary)
            }
            ForEach(model.files) { f in
                LabeledContent(f.filename, value: ByteCountFormatter.string(fromByteCount: Int64(f.size), countStyle: .file))
            }
            if model.files.count > 1 {
                Toggle("Gehören zu einer Buchung (zusammen auswerten)", isOn: $model.grouped)
            }
        }
    }

    @ViewBuilder
    private var tripsSection: some View {
        Section("Neue Reise …") {
            HStack {
                TextField("Name der neuen Reise", text: $model.newTripTitle)
                if model.creatingTrip {
                    ProgressView()
                } else {
                    Button("Anlegen") { Task { await model.createTrip() } }
                        .disabled(model.newTripTitle.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        Section("In Reise") {
            if model.trips.isEmpty { Text("Keine Reise, in der du bearbeiten darfst.").foregroundStyle(.secondary) }
            ForEach(model.upcoming) { tripRow($0) }
            if !model.past.isEmpty {
                DisclosureGroup("Vergangen", isExpanded: $showPast) {
                    ForEach(model.past) { tripRow($0) }
                }
            }
        }
    }

    private func tripRow(_ t: TripSummary) -> some View {
        Button {
            model.selectedTripId = t.id
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(t.title).foregroundStyle(.primary)
                    if let s = t.effectiveStartDate { Text(String(s.prefix(10))).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                if model.selectedTripId == t.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
    }
}

// ENDE ShareView.swift
