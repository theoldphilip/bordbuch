//
//  PlaceLookupView.swift
//  Reisebuch
//
//  Reisetag-Abfrage (Kasten „Am Reisetag“) für Flug, Zug und Mietwagen, wie PlaceLookupPanel.tsx der Web-App.
//  Vertrag: docs/API.md „Reisetag-Abfrage“. Starten mit POST, alle 3 s GET bis fertig (höchstens 4 min).
//  Gespeichert wird erst mit „Übernehmen“: PATCH /api/items/:id mit ALLEN bisherigen details plus den gewählten Werten,
//  weil der Server details als Ganzes ersetzt. Das ist der einzige schreibende Aufruf der App.
//

import SwiftUI

struct PlaceLookupSection: View {
    @Environment(AppSession.self) private var session
    @Binding var item: Item
    let onChanged: () async -> Void

    @State private var lookup: PlaceLookup?
    @State private var polling = false
    @State private var starting = false
    @State private var applying = false
    @State private var selected: Set<String> = []
    @State private var message: String?
    @State private var appliedNote: String?

    private static let pollInterval: Duration = .seconds(3)
    private static let maxPolls = 80 // 80 × 3 s = 4 min

    private var buttonTitle: String {
        switch item.type {
        case "train": return "Gleis abfragen"
        case "car_rental": return "Schalter abfragen"
        default: return "Terminal, Schalter, Gate, Kofferband abfragen"
        }
    }

    private var isPending: Bool { lookup?.status == "pending" || polling || starting }

    var body: some View {
        Section("Am Reisetag") {
            Button {
                Task { await start() }
            } label: {
                HStack {
                    if isPending { ProgressView().padding(.trailing, 4) }
                    Text(isPending ? "Sucht …" : buttonTitle)
                }
            }
            .disabled(isPending || applying || session.isOffline)

            if session.isOffline {
                Text("Nur mit Verbindung").font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("Sucht auf Live-Seiten von Flughafen, Airline oder Bahn gezielt nach diesem Termin. Gespeichert wird erst mit ‚Übernehmen‘.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if let message {
                Label(message, systemImage: "exclamationmark.triangle").foregroundStyle(.red).font(.subheadline)
            }
            if let appliedNote {
                Label(appliedNote, systemImage: "checkmark.circle").foregroundStyle(.green).font(.subheadline)
            }

            if let lookup, lookup.status == "failed" {
                Label(lookup.error ?? "Die Abfrage ist fehlgeschlagen.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .font(.subheadline)
            }

            if let lookup, lookup.status == "done" {
                let findings = lookup.findings ?? []
                ForEach(findings, id: \.key) { finding in
                    FindingRow(finding: finding, current: item.detailMap[finding.key], isOn: Binding(
                        get: { selected.contains(finding.key) },
                        set: { on in if on { selected.insert(finding.key) } else { selected.remove(finding.key) } }
                    ))
                }
                VStack(alignment: .leading, spacing: 4) {
                    if let summary = lookup.summary, !summary.isEmpty {
                        Text(summary).font(.subheadline)
                    }
                    if findings.isEmpty {
                        Text("Schau auf die Anzeigetafel oder in die App der Airline bzw. Bahn.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let time = Fmt.clockFromISO(lookup.finishedAt) {
                        Text("Stand \(time)").font(.caption).foregroundStyle(.secondary)
                    }
                    if let queries = lookup.queries, !queries.isEmpty {
                        Text("gesucht: \(queries.joined(separator: " · "))").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !findings.isEmpty {
                    Button {
                        Task { await apply(findings) }
                    } label: {
                        HStack {
                            if applying { ProgressView().padding(.trailing, 4) }
                            Text("Übernehmen (\(selected.count))").bold()
                        }
                    }
                    .disabled(selected.isEmpty || applying || session.isOffline)
                }
            }
        }
        .task { await loadExisting() }
    }

    // MARK: Ablauf

    /// Ein laufendes oder fertiges Ergebnis beim Öffnen gleich zeigen.
    private func loadExisting() async {
        guard let current = await fetchCurrent() else { return }
        show(current)
        if current?.status == "pending" { await poll() }
    }

    /// Aktueller Stand vom Server: nil = Abfrage gescheitert, .some(nil) = noch keine Abfrage für diesen Eintrag.
    private func fetchCurrent() async -> PlaceLookup?? {
        do {
            return .some(try await session.call { try await $0.placeLookup(itemId: item.id) })
        } catch {
            return nil
        }
    }

    private func start() async {
        message = nil
        appliedNote = nil
        starting = true
        defer { starting = false }
        do {
            let started = try await session.call { try await $0.startPlaceLookup(itemId: item.id) }
            show(started)
            if started?.status != "done" && started?.status != "failed" { await poll() }
        } catch APIError.server(status: 409, let text) {
            // Läuft schon (oder KI fehlt): den laufenden Stand abfragen.
            let current = await fetchCurrent()
            if let current, current?.status == "pending" {
                show(current)
                await poll()
            } else {
                message = text ?? "Die Abfrage ist gerade nicht möglich."
            }
        } catch APIError.server(status: 403, _) {
            message = "Nur Bearbeiter können abfragen."
        } catch is CancellationError {
            return
        } catch {
            message = error.localizedDescription
        }
    }

    private func poll() async {
        guard !polling else { return }
        polling = true
        defer { polling = false }
        for _ in 0..<Self.maxPolls {
            do {
                try await Task.sleep(for: Self.pollInterval)
            } catch {
                return // Ansicht geschlossen
            }
            guard let current = await fetchCurrent() else { continue }
            show(current)
            if current?.status != "pending" { return }
        }
        message = "Die Abfrage dauert zu lange. Öffne den Eintrag später noch einmal."
    }

    private func show(_ new: PlaceLookup?) {
        let wasDone = lookup?.status == "done" && lookup?.finishedAt == new?.finishedAt
        lookup = new
        if new?.status == "done", !wasDone {
            selected = Self.preselection(new?.findings ?? [])
        }
    }

    /// Vorausgewählt ist, was neu oder anders ist als das Eingetragene.
    static func preselection(_ findings: [PlaceLookupFinding]) -> Set<String> {
        Set(findings.filter { f in
            let current = f.current?.trimmingCharacters(in: .whitespaces) ?? ""
            return current.isEmpty || current != f.value.trimmingCharacters(in: .whitespaces)
        }.map(\.key))
    }

    /// Alle bisherigen details plus die gewählten Werte (der Server ersetzt details als Ganzes).
    static func mergedDetails(_ existing: [String: JSONValue], findings: [PlaceLookupFinding],
                              selected: Set<String>) -> [String: JSONValue] {
        var result = existing
        for f in findings where selected.contains(f.key) {
            result[f.key] = .string(f.value)
        }
        return result
    }

    private func apply(_ findings: [PlaceLookupFinding]) async {
        message = nil
        applying = true
        defer { applying = false }
        let details = Self.mergedDetails(item.details?.raw ?? [:], findings: findings, selected: selected)
        do {
            let updated = try await session.call { try await $0.patchItemDetails(itemId: item.id, details: details) }
            let count = selected.count
            item = updated
            selected = []
            appliedNote = count == 1 ? "1 Angabe übernommen." : "\(count) Angaben übernommen."
            await onChanged()
        } catch APIError.server(status: 403, _) {
            message = "Nur Bearbeiter können ändern."
        } catch is CancellationError {
            return
        } catch {
            message = error.localizedDescription
        }
    }
}

private struct FindingRow: View {
    let finding: PlaceLookupFinding
    /// Was jetzt am Eintrag steht (nach „Übernehmen“ also schon der neue Wert).
    let current: String?
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(finding.label) \(finding.value)").bold()
                    Text(comparison).font(.subheadline).foregroundStyle(.secondary)
                }
                if let note = finding.note, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
                if let source = finding.source, let text = source.url, let url = URL(string: text) {
                    Link(source.title?.isEmpty == false ? source.title! : text, destination: url)
                        .font(.caption)
                }
            }
        }
        .toggleStyle(CheckToggleStyle())
    }

    private var comparison: String {
        let current = (current ?? finding.current)?.trimmingCharacters(in: .whitespaces) ?? ""
        if current.isEmpty { return "(neu)" }
        return current == finding.value.trimmingCharacters(in: .whitespaces) ? "(wie eingetragen)" : "(bisher \(current))"
    }
}

/// Häkchen links statt Schalter, wie eine Checkliste.
private struct CheckToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(configuration.isOn ? Color.accentColor : .secondary)
                    .font(.title3)
                configuration.label
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// ENDE PlaceLookupView.swift
