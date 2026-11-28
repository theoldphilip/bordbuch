//
//  TripReviewView.swift
//  Reisebuch
//
//  „Reise prüfen“ (Auftrag 0.8.0, wie TripReviewDialog.tsx): KI-Durchsicht der ganzen Reise, nur lesend. Ergebnis je Reise auf dem
//  Server gespeichert; starten nur Bearbeiter, Betrachter sehen das gespeicherte Ergebnis. Läuft im Hintergrund, alle 3 s abfragen.
//

import SwiftUI

struct TripReviewView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let edit: EditContext
    /// Einträge des Ablaufs (zum Öffnen aus einem Fund).
    let items: [String: Item]

    @State private var state: TripReviewState?
    @State private var errorText: String?
    @State private var busy = false

    private var canStart: Bool { AIFeatures(status: session.aiStatus, role: edit.isEditor ? "editor" : "viewer").canStartReview }
    private var review: TripReview? { state?.review }

    var body: some View {
        NavigationStack {
            List {
                if let errorText {
                    Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
                if state == nil && errorText == nil {
                    Section { ProgressView() }
                } else if state != nil && review == nil {
                    Section {
                        Text("Die KI sieht sich die ganze Reise an und sucht nach Lücken und Widersprüchen, zum Beispiel fehlende Rückreise, kein Transfer zum Hafen, Hotelnächte, die nicht passen, oder Einträge außerhalb der Reise. Sie ändert nichts, du bekommst nur eine Liste.")
                        Text("Dafür gehen Titel, Zeiten und Orte der Einträge an den eingestellten KI-Anbieter. Buchungsnummern, Preise, Telefonnummern und die Dokumente selbst werden nicht gesendet.")
                            .font(.footnote).foregroundStyle(.secondary)
                        if canStart {
                            Button("🔍 Prüfung starten") { Task { await start() } }.disabled(busy)
                        } else {
                            Text("Nur Bearbeiter können die Prüfung starten.").foregroundStyle(.secondary)
                        }
                    }
                }
                if let review { resultView(review) }
            }
            .navigationTitle("Reise prüfen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Schließen") { dismiss() } }
                if canStart, let review, review.status != "pending" {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Neu prüfen") { Task { await start() } }.disabled(busy)
                    }
                }
            }
            .task { await load() }
            .task(id: review?.status) {
                while Polling.shouldContinue(review?.status) && !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3))
                    if Task.isCancelled { break }
                    await load()
                }
            }
        }
    }

    @ViewBuilder
    private func resultView(_ r: TripReview) -> some View {
        switch r.status {
        case "pending":
            Section {
                HStack {
                    ProgressView()
                    Text("Die KI prüft die Reise … das dauert bis zu einer Minute.")
                }
            }
        case "failed":
            Section {
                Text(r.error ?? "Die Prüfung ist fehlgeschlagen.").foregroundStyle(.red)
                if canStart { Button("Erneut versuchen") { Task { await start() } }.disabled(busy) }
            }
        default:
            if state?.stale == true {
                Section {
                    Label("Die Reise wurde seit der Prüfung geändert. Mit „Neu prüfen“ bekommst du den aktuellen Stand.",
                          systemImage: "clock.arrow.circlepath")
                        .foregroundStyle(.orange)
                    if canStart { Button("Neu prüfen") { Task { await start() } }.disabled(busy) }
                }
            }
            Section {
                if let s = r.summary, !s.isEmpty { Text(s) }
                Text(ReviewLogic.countText(r.findings ?? []) + (r.finishedAt.map { " · Stand \(Fmt.stamp(isoDate($0)))" } ?? ""))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(Array(ReviewLogic.sorted(r.findings ?? []).enumerated()), id: \.offset) { _, f in
                Section { findingView(f) }
            }
            Section {
                Text("KI-Einschätzung auf Basis der erfassten Daten. Bitte selbst gegenprüfen, bevor du etwas änderst" + (r.model.map { " (\($0))." } ?? "."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func findingView(_ f: ReviewFinding) -> some View {
        let sev = ReviewLogic.label(f.severity)
        VStack(alignment: .leading, spacing: 4) {
            Text("\(sev.icon) \(f.title)").bold().foregroundStyle(color(f.severity))
            if let t = f.text, !t.isEmpty { Text(t) }
            if let s = f.suggestion, !s.isEmpty { Text("➜ \(s)").foregroundStyle(.secondary) }
        }
        ForEach(f.itemIds ?? [], id: \.self) { id in
            if let item = items[id] {
                NavigationLink {
                    ItemDetailView(item: item, warnings: [], tripRole: edit.isEditor ? "editor" : "viewer", onChanged: edit.reload,
                                   edit: edit)
                } label: {
                    Label(item.title, systemImage: "arrow.right.circle")
                }
            }
        }
        ForEach(f.dayIds ?? [], id: \.self) { id in
            if let day = edit.allDays.first(where: { $0.day.id == id })?.day {
                NavigationLink {
                    CruiseDayDetailView(day: day, edit: edit)
                } label: {
                    Label("Tag \(Fmt.local(day.date))\(day.portName.map { " · \($0)" } ?? "")", systemImage: "arrow.right.circle")
                }
            }
        }
    }

    private func color(_ severity: String) -> Color {
        switch ReviewLogic.colorName(severity) {
        case "red": return .red
        case "orange": return .orange
        default: return .primary
        }
    }

    private func isoDate(_ s: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s) ?? Date()
    }

    private func load() async {
        do {
            state = try await session.call { try await $0.tripReview(tripId: edit.tripId) }
            errorText = nil
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func start() async {
        busy = true
        errorText = nil
        defer { busy = false }
        do {
            state = try await session.call { try await $0.startTripReview(tripId: edit.tripId) }
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

// ENDE TripReviewView.swift
