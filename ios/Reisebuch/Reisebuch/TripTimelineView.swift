//
//  TripTimelineView.swift
//  Reisebuch
//
//  Ablauf einer Reise (nur lesen): Hinweise des Puffer-Checks oben, dann Abschnitte → Tage → Einträge.
//  Aufbau wie GET /api/trips/:id/timeline (docs/API.md „Timeline“).
//

import SwiftUI

struct TripTimelineView: View {
    @Environment(AppSession.self) private var session
    let trip: TripSummary

    @State private var timeline: Timeline?
    @State private var errorText: String?

    var body: some View {
        List {
            if let errorText {
                Section {
                    Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                }
            }
            if let timeline {
                WarningsSection(warnings: timeline.warnings)
                ForEach(Array(timeline.phases.enumerated()), id: \.offset) { _, phase in
                    PhaseSection(phase: phase, warningsByItem: openWarningsByItem(timeline.warnings))
                }
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if timeline == nil && errorText == nil { ProgressView() }
        }
        .navigationTitle(trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func openWarningsByItem(_ warnings: [TimelineWarning]) -> [String: [TimelineWarning]] {
        var result: [String: [TimelineWarning]] = [:]
        for w in warnings where w.ack == nil {
            if let id = w.itemId { result[id, default: []].append(w) }
        }
        return result
    }

    private func load() async {
        do {
            timeline = try await session.call { try await $0.timeline(tripId: trip.id) }
            errorText = nil
        } catch is CancellationError {
            return
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// MARK: - Hinweise

struct WarningStyle {
    static func color(_ level: String) -> Color {
        switch level {
        case "error": return .red
        case "warning": return .orange
        default: return .blue
        }
    }

    static func icon(_ level: String) -> String {
        switch level {
        case "error": return "exclamationmark.octagon.fill"
        case "warning": return "exclamationmark.triangle.fill"
        default: return "info.circle.fill"
        }
    }

    static func rank(_ level: String) -> Int {
        switch level {
        case "error": return 0
        case "warning": return 1
        default: return 2
        }
    }
}

private struct WarningsSection: View {
    let warnings: [TimelineWarning]
    @State private var expanded: Bool?
    @State private var ackExpanded = false

    private var open: [TimelineWarning] {
        warnings.filter { $0.ack == nil }.sorted { WarningStyle.rank($0.level) < WarningStyle.rank($1.level) }
    }
    private var acked: [TimelineWarning] { warnings.filter { $0.ack != nil } }

    private var worstLevel: String { open.first?.level ?? "info" }

    var body: some View {
        if !warnings.isEmpty {
            Section {
                DisclosureGroup(isExpanded: Binding(
                    get: { expanded ?? open.contains { $0.level == "error" } },
                    set: { expanded = $0 }
                )) {
                    if open.isEmpty {
                        Text("Keine offenen Hinweise.").foregroundStyle(.secondary)
                    }
                    ForEach(Array(open.enumerated()), id: \.offset) { _, w in
                        WarningRow(warning: w)
                    }
                    if !acked.isEmpty {
                        DisclosureGroup("Quittiert (\(acked.count))", isExpanded: $ackExpanded) {
                            ForEach(Array(acked.enumerated()), id: \.offset) { _, w in
                                WarningRow(warning: w).opacity(0.6)
                            }
                        }
                    }
                } label: {
                    Label {
                        Text(open.count == 1 ? "1 Hinweis" : "\(open.count) Hinweise").bold()
                    } icon: {
                        Image(systemName: open.isEmpty ? "checkmark.circle.fill" : WarningStyle.icon(worstLevel))
                            .foregroundStyle(open.isEmpty ? Color.green : WarningStyle.color(worstLevel))
                    }
                }
            }
            .listRowBackground(open.isEmpty ? nil : WarningStyle.color(worstLevel).opacity(0.12))
        }
    }
}

struct WarningRow: View {
    let warning: TimelineWarning
    var compact = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: WarningStyle.icon(warning.level))
                .foregroundStyle(WarningStyle.color(warning.level))
                .font(compact ? .caption : .body)
            VStack(alignment: .leading, spacing: 2) {
                Text(warning.message)
                    .font(compact ? .caption : .subheadline)
                    .foregroundStyle(compact ? WarningStyle.color(warning.level) : .primary)
                if warning.personal == true {
                    Text("nur persönlich")
                        .font(.caption2.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(Color.secondary.opacity(0.2)))
                }
            }
        }
    }
}

// MARK: - Abschnitte und Tage

private struct PhaseSection: View {
    let phase: TimelinePhase
    let warningsByItem: [String: [TimelineWarning]]

    var body: some View {
        Section {
            if phase.days.isEmpty {
                Text("Keine Einträge").foregroundStyle(.secondary)
            }
            ForEach(Array(phase.days.enumerated()), id: \.offset) { _, day in
                DayHeaderRow(day: day)
                ForEach(Array(day.entries.enumerated()), id: \.offset) { _, entry in
                    NavigationLink {
                        ItemDetailView(item: entry.item, warnings: warningsByItem[entry.itemId] ?? [])
                    } label: {
                        EntryRow(entry: entry, warnings: warningsByItem[entry.itemId] ?? [])
                    }
                }
            }
        } header: {
            Text(phase.title)
        }
    }
}

private struct DayHeaderRow: View {
    let day: TimelineDay

    var body: some View {
        if let cd = day.cruiseDay {
            NavigationLink {
                CruiseDayDetailView(day: cd)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Fmt.dayHeader(day.date)).font(.headline)
                    CruiseDaySummary(day: cd)
                }
                .padding(.vertical, 2)
            }
        } else {
            Text(Fmt.dayHeader(day.date))
                .font(.headline)
                .padding(.top, 4)
        }
    }
}

struct CruiseDaySummary: View {
    let day: CruiseDay

    var body: some View {
        let kind = Labels.dayKind(day.kind)
        VStack(alignment: .leading, spacing: 4) {
            Text("\(kind.icon) \(kind.label)\(portText)")
                .font(.subheadline)
            let times = [day.arrival.map { "Ankunft \($0)" }, day.departure.map { "Abfahrt \($0)" }].compactMap { $0 }
            if !times.isEmpty {
                Text(times.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                if let allAboard = day.allAboard, !allAboard.isEmpty {
                    Text("Alle an Bord \(allAboard)")
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange))
                }
                if day.tender == true {
                    Text("Tenderhafen")
                        .font(.caption.bold())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().strokeBorder(Color.secondary))
                }
            }
        }
    }

    private var portText: String {
        let parts = [day.portName, day.country].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "" : " · " + parts.joined(separator: ", ")
    }
}

// MARK: - Eintrag

private struct EntryRow: View {
    let entry: TimelineEntry
    let warnings: [TimelineWarning]

    private var item: Item { entry.item }

    var body: some View {
        let type = Labels.itemType(item.type)
        let place = Labels.placeLine(item)
        let subtitle = Labels.subtitle(item)
        HStack(alignment: .top, spacing: 10) {
            Text(entry.time ?? "")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 46, alignment: .leading)
            Text(type.icon).accessibilityLabel(type.label)
            VStack(alignment: .leading, spacing: 3) {
                Text(titleText).font(.body)
                if !place.isEmpty {
                    Text(place).font(.subheadline.bold())
                }
                if !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(.secondary)
                }
                ForEach(Array(roleWarnings.enumerated()), id: \.offset) { _, w in
                    WarningRow(warning: w, compact: true)
                }
            }
        }
        .padding(.vertical, 2)
    }

    /// Hinweise mit Rolle (start/end) nur beim passenden Auftritt des Eintrags zeigen.
    private var roleWarnings: [TimelineWarning] {
        warnings.filter { $0.role == nil || $0.role == entry.role }
    }

    private var titleText: String {
        if entry.role == "end" {
            let label = Labels.endLabel(item.type) ?? "Ende"
            return "\(label) · \(item.title)"
        }
        return item.title
    }
}

// ENDE TripTimelineView.swift
