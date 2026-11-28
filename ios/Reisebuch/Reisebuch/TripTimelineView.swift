//
//  TripTimelineView.swift
//  Reisebuch
//
//  Ablauf einer Reise: Hinweise des Puffer-Checks oben (mit Quittieren), dann Abschnitte → Tage → Einträge.
//  Aufbau wie GET /api/trips/:id/timeline (docs/API.md „Timeline“). Seit 0.6.0 mit Bearbeiten für owner/editor und
//  Ansichtsmodus wie in der Web-App (ab dem ersten begonnenen Punkt gesperrt, bis zum Beenden der App entsperrbar).
//

import SwiftUI

struct TripTimelineView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    let trip: TripSummary

    @State private var timeline: Timeline?
    @State private var detail: TripDetail?
    @State private var showTripForm = false
    @State private var showNewItem = false
    @State private var confirmDeleteTrip = false
    @State private var confirmUnlock = false
    @State private var cruiseToEdit: CruiseSummary?
    @State private var cruiseForNewDay: CruiseSummary?
    @State private var actionError: String?
    @State private var reviewDoc: DocumentsView.ReviewTarget?
    @State private var showTripReview = false
    @State private var errorText: String?
    /// Gesetzt, solange der gespeicherte Ablauf gezeigt wird, weil der Server nicht erreichbar ist.
    @State private var offlineSince: Date?
    @State private var now = Date()
    @State private var didScrollToNow = false
    @State private var startedUp = false

    var body: some View {
        ScrollViewReader { proxy in
            dialogs(sheets(list))
                .refreshable { await load() }
                .task {
                    if !startedUp {
                        startedUp = true
                        if let cached = session.cachedTimeline(tripId: trip.id) {
                            timeline = cached.value
                            await scrollToNowOnce(proxy)
                        }
                    }
                    await load()
                    await scrollToNowOnce(proxy)
                }
                .task {
                    // „Jetzt“ jede Minute neu berechnen.
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(60))
                        now = Date()
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { now = Date() }
                }
        }
    }

    private var list: some View {
        List {
            if let offlineSince {
                OfflineBanner(savedAt: offlineSince)
            }
            if let errorText {
                Section {
                    Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                }
            }
            if let actionError {
                Section {
                    Label(actionError, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                }
            }
            if let timeline {
                timelineContent(timeline)
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if timeline == nil && errorText == nil { ProgressView() }
        }
        .navigationTitle(detail?.trip?.title ?? trip.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
    }

    @ViewBuilder
    private func timelineContent(_ timeline: Timeline) -> some View {
        let context = TimelineContext(timeline: timeline, now: now, tripRole: role,
                                      warningsByItem: openWarningsByItem(timeline.warnings),
                                      reload: { await load() }, edit: editContext(timeline))
        if isEditor && started(timeline) {
            ViewModeRow(locked: locked(timeline), onUnlock: { confirmUnlock = true },
                        onLock: { session.unlockedTrips.remove(trip.id) })
        }
        WarningsSection(warnings: timeline.warnings, canAck: isEditor, onAck: { key, ack in await self.ack(key, ack) })
        if detail != nil {
            DocumentsLinkSection(attachments: detail?.attachments ?? [], edit: context.edit, itemTitles: itemTitles(timeline))
        }
        ForEach(Array(timeline.phases.enumerated()), id: \.offset) { _, phase in
            PhaseSection(phase: phase, context: context)
        }
    }

    private func sheets(_ content: some View) -> some View {
        content
            .sheet(isPresented: $showTripForm) {
                TripFormView(trip: tripInfo) { _ in Task { await load() } }
            }
            .sheet(isPresented: $showNewItem) {
                if let timeline { ItemFormView(ctx: editContext(timeline)) { _ in } }
            }
            .sheet(item: $cruiseToEdit) { cruise in
                if let timeline { CruiseFormView(cruise: cruise, ctx: editContext(timeline)) }
            }
            .sheet(item: $cruiseForNewDay) { cruise in
                if let timeline { CruiseDayFormView(cruise: cruise, ctx: editContext(timeline)) }
            }
            .sheet(isPresented: $showTripReview) {
                if let timeline {
                    TripReviewView(edit: editContext(timeline),
                                   items: Dictionary(timeline.phases.flatMap(\.days).flatMap(\.entries).map { ($0.itemId, $0.item) },
                                                     uniquingKeysWith: { a, _ in a }))
                }
            }
            .sheet(item: $reviewDoc) { target in
                if let timeline { DocReviewView(attachmentId: target.id, edit: editContext(timeline)) { Task { await load() } } }
            }
            .onChange(of: session.pendingDocumentId) { _, _ in openPendingDocument() }
    }

    private func dialogs(_ content: some View) -> some View {
        content
            .confirmationDialog("„\(detail?.trip?.title ?? trip.title)“ löschen?", isPresented: $confirmDeleteTrip,
                                titleVisibility: .visible) {
                Button("Reise löschen", role: .destructive) { Task { await deleteTrip() } }
            } message: {
                Text("Alle Einträge, Kreuzfahrten und Dokumente dieser Reise werden mit gelöscht. Das lässt sich nicht rückgängig machen.")
            }
            .confirmationDialog("Ansichtsmodus verlassen?", isPresented: $confirmUnlock, titleVisibility: .visible) {
                Button("Bearbeiten entsperren") { session.unlockedTrips.insert(trip.id) }
            } message: {
                Text("Die Reise läuft. Änderungen sind bis zum Beenden der App wieder möglich.")
            }
    }

    /// Beim Öffnen einer laufenden Reise einmal zur Markierung scrollen, nicht bei jeder Aktualisierung.
    private func scrollToNowOnce(_ proxy: ScrollViewProxy) async {
        guard !didScrollToNow, let timeline, NowLogic.nowElement(timeline, now: now) != nil else { return }
        didScrollToNow = true
        try? await Task.sleep(for: .milliseconds(300))
        withAnimation { proxy.scrollTo(NowMarkerRow.rowID, anchor: .center) }
    }

    private func openWarningsByItem(_ warnings: [TimelineWarning]) -> [String: [TimelineWarning]] {
        var result: [String: [TimelineWarning]] = [:]
        for w in warnings where w.ack == nil {
            if let id = w.itemId { result[id, default: []].append(w) }
        }
        return result
    }

    // MARK: Rechte und Bearbeiten

    private var role: String? { detail?.role ?? trip.role }
    private var isEditor: Bool { ViewMode.isEditor(role) }
    private var isOwner: Bool { role == "owner" }
    private func started(_ t: Timeline) -> Bool { ViewMode.started(t, now: now) }
    private func locked(_ t: Timeline) -> Bool {
        ViewMode.locked(isEditor: isEditor, started: started(t), unlocked: session.unlockedTrips.contains(trip.id))
    }

    private var tripInfo: TripInfo {
        detail?.trip ?? TripInfo(id: trip.id, title: trip.title, kind: trip.kind, startDate: trip.startDate,
                                 endDate: trip.endDate, notes: nil)
    }

    private func editContext(_ t: Timeline) -> EditContext {
        let defaultTz = t.defaultTimezone ?? "Europe/Zurich"
        let lastTz = t.phases.flatMap(\.days).flatMap(\.entries).last?.timezone
        return EditContext(tripId: trip.id, tripTitle: detail?.trip?.title ?? trip.title, tripKind: detail?.trip?.kind ?? trip.kind, cruises: detail?.cruises ?? [],
                           defaultTz: defaultTz, suggestedTz: lastTz ?? defaultTz, isEditor: isEditor, isOwner: isOwner,
                           canEdit: isEditor && !locked(t), reload: { await load() })
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        // KI-Prüfung: auch im Ansichtsmodus und für Betrachter (gespeichertes Ergebnis).
        if AIFeatures(status: session.aiStatus, role: role).showReview, timeline != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Button("🔍 Prüfen") { showTripReview = true }
            }
        }
        if isEditor, let timeline {
            if locked(timeline) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { confirmUnlock = true } label: { Image(systemName: "lock.fill") }
                        .accessibilityLabel("Bearbeiten entsperren")
                }
            } else {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Reise bearbeiten", systemImage: "pencil") { showTripForm = true }
                        ForEach(detail?.cruises ?? []) { c in
                            Button("Kreuzfahrt \(c.shipName ?? "") bearbeiten", systemImage: "ferry") { cruiseToEdit = c }
                            Button("Reisetag hinzufügen (\(c.shipName ?? "Kreuzfahrt"))", systemImage: "calendar.badge.plus") {
                                cruiseForNewDay = c
                            }
                        }
                        if isOwner {
                            Divider()
                            Button("Reise löschen", systemImage: "trash", role: .destructive) { confirmDeleteTrip = true }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel("Reise bearbeiten")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showNewItem = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Eintrag hinzufügen")
                }
            }
        }
    }

    /// Hinweis quittieren oder zurücknehmen; 404 heißt: nicht mehr aktuell, Ablauf neu laden.
    private func ack(_ key: String, _ ack: Bool) async {
        actionError = nil
        do {
            try await session.call { try await $0.ackWarning(tripId: trip.id, key: key, ack: ack) }
        } catch APIError.server(404, _) {
            // nicht mehr aktuell
        } catch {
            actionError = SaveError.text(error)
        }
        await load()
    }

    private func deleteTrip() async {
        actionError = nil
        do {
            try await session.call { try await $0.deleteTrip(tripId: trip.id) }
            _ = try? await session.fetchTrips()
            dismiss()
        } catch {
            actionError = SaveError.text(error)
        }
    }

    private func itemTitles(_ t: Timeline) -> [String: String] {
        var result: [String: String] = [:]
        for e in t.phases.flatMap(\.days).flatMap(\.entries) { result[e.itemId] = e.item.title }
        return result
    }

    /// Mitteilung „Dokument gelesen“ angetippt: Vorschläge dieses Dokuments zeigen, sobald es in der Reise steht.
    private func openPendingDocument() {
        guard let id = session.pendingDocumentId, timeline != nil,
              detail?.attachments?.contains(where: { $0.id == id }) == true else { return }
        session.pendingDocumentId = nil
        reviewDoc = DocumentsView.ReviewTarget(id: id)
    }

    private func load() async {
        if detail == nil { detail = session.cachedTripDetail(tripId: trip.id) }
        if let fresh = try? await session.fetchTripDetail(tripId: trip.id) { detail = fresh }
        defer { openPendingDocument() }
        do {
            timeline = try await session.fetchTimeline(tripId: trip.id)
            errorText = nil
            offlineSince = nil
        } catch is CancellationError {
            return
        } catch {
            if let cached = session.cachedTimeline(tripId: trip.id) {
                timeline = cached.value
                if case APIError.unreachable = error {
                    offlineSince = cached.savedAt
                    errorText = nil
                } else {
                    offlineSince = nil
                    errorText = error.localizedDescription
                }
            } else {
                errorText = error.localizedDescription
            }
        }
        now = Date()
    }
}

/// Was die Abschnitte zum Zeichnen brauchen: Zeitpunkt, Markierung, Hinweise, Rolle.
struct TimelineContext {
    let timeline: Timeline
    let now: Date
    let tripRole: String?
    let warningsByItem: [String: [TimelineWarning]]
    let reload: () async -> Void
    let edit: EditContext

    var defaultTz: String { timeline.defaultTimezone ?? "Europe/Zurich" }
    var nowElement: NowLogic.Element? { NowLogic.nowElement(timeline, now: now) }
    var today: String { NowLogic.today(in: defaultTz, now: now) }

    func isPast(_ e: TimelineEntry) -> Bool { NowLogic.entryEnd(e, defaultTz: defaultTz) < now }
    func isPast(_ d: CruiseDay) -> Bool { NowLogic.dayEnd(d, defaultTz: defaultTz) < now }
}

/// Dünne Linie mit Etikett „Jetzt · 14:32“, Uhrzeit in der Zone des folgenden Elements.
struct NowMarkerRow: View {
    static let rowID = "jetzt-markierung"
    static let color = Color(red: 0xd6 / 255, green: 0x33 / 255, blue: 0x6c / 255)
    let now: Date
    let timezone: String

    var body: some View {
        HStack(spacing: 8) {
            Text("Jetzt · \(NowLogic.clock(now, tz: timezone))")
                .font(.caption.bold())
                .foregroundStyle(.white)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Capsule().fill(Self.color))
            Rectangle().fill(Self.color).frame(height: 2)
        }
        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 12))
        .listRowBackground(Color.clear)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Jetzt, \(NowLogic.clock(now, tz: timezone))")
        .id(Self.rowID)
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

/// Band „Ansichtsmodus“ bzw. „Bearbeiten ist aktiv“ (wie in der Web-App).
private struct ViewModeRow: View {
    let locked: Bool
    let onUnlock: () -> Void
    let onLock: () -> Void

    var body: some View {
        Section {
            if locked {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Ansichtsmodus: Die Reise läuft, Änderungen sind gesperrt.", systemImage: "lock.fill")
                        .font(.subheadline)
                    Button("Bearbeiten entsperren", action: onUnlock).font(.subheadline)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Bearbeiten ist aktiv. Bis du die App beendest.", systemImage: "lock.open.fill")
                        .font(.subheadline)
                    Button("Ansichtsmodus einschalten", action: onLock).font(.subheadline)
                }
            }
        }
        .listRowBackground(locked ? Color.secondary.opacity(0.12) : Color.green.opacity(0.12))
    }
}

private struct WarningsSection: View {
    let warnings: [TimelineWarning]
    let canAck: Bool
    let onAck: (String, Bool) async -> Void
    @State private var expanded: Bool?
    @State private var busyKey: String?
    @State private var ackExpanded = false

    private var open: [TimelineWarning] {
        warnings.filter { $0.ack == nil }.sorted { WarningStyle.rank($0.level) < WarningStyle.rank($1.level) }
    }
    private var acked: [TimelineWarning] { warnings.filter { $0.ack != nil } }

    private var worstLevel: String { open.first?.level ?? "info" }

    @ViewBuilder
    private func ackButton(_ w: TimelineWarning, ack: Bool) -> some View {
        if canAck, let key = w.key {
            if busyKey == key {
                ProgressView()
            } else {
                Button(ack ? "Quittieren" : "Quittierung zurücknehmen") {
                    Task {
                        busyKey = key
                        await onAck(key, ack)
                        busyKey = nil
                    }
                }
                .font(.caption)
                .buttonStyle(.borderless)
            }
        }
    }

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
                        VStack(alignment: .leading, spacing: 4) {
                            WarningRow(warning: w)
                            ackButton(w, ack: true)
                        }
                    }
                    if !acked.isEmpty {
                        DisclosureGroup("Quittiert (\(acked.count))", isExpanded: $ackExpanded) {
                            ForEach(Array(acked.enumerated()), id: \.offset) { _, w in
                                VStack(alignment: .leading, spacing: 4) {
                                    WarningRow(warning: w).opacity(0.6)
                                    if let by = w.ack?.by {
                                        Text("quittiert von \(by)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    ackButton(w, ack: false)
                                }
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
    let context: TimelineContext

    var body: some View {
        let nowElement = context.nowElement
        Section {
            if phase.days.isEmpty {
                Text("Keine Einträge").foregroundStyle(.secondary)
            }
            ForEach(Array(phase.days.enumerated()), id: \.offset) { _, day in
                let keys = (day.cruiseDay.map { [NowLogic.dayKey($0)] } ?? []) + day.entries.map { NowLogic.entryKey($0) }
                let dayFuture = day.date > context.today
                // Markierung vor der Tagesüberschrift: wenn das erste Element eines künftigen Tages folgt, oder der
                // Kreuzfahrt-Tag selbst (Überschrift und Hafenkarte sind hier eine Zeile).
                let markerBeforeHeader = nowElement.map { el in
                    el.key == keys.first && (dayFuture || day.cruiseDay != nil)
                } ?? false
                if markerBeforeHeader, let el = nowElement {
                    NowMarkerRow(now: context.now, timezone: el.timezone)
                }
                DayHeaderRow(day: day, context: context, allPast: allPast(day, keys: keys))
                ForEach(Array(day.entries.enumerated()), id: \.offset) { _, entry in
                    let key = NowLogic.entryKey(entry)
                    if let el = nowElement, el.key == key, !(markerBeforeHeader && key == keys.first) {
                        NowMarkerRow(now: context.now, timezone: el.timezone)
                    }
                    NavigationLink {
                        ItemDetailView(item: entry.item, warnings: context.warningsByItem[entry.itemId] ?? [],
                                       tripRole: context.tripRole, onChanged: context.reload, edit: context.edit)
                    } label: {
                        EntryRow(entry: entry, warnings: context.warningsByItem[entry.itemId] ?? [])
                            .opacity(context.isPast(entry) ? 0.45 : 1)
                    }
                }
            }
        } header: {
            Text(phase.title)
        }
    }

    /// Alle Elemente des Tages vorbei (ohne Elemente: der Tag liegt vor heute).
    private func allPast(_ day: TimelineDay, keys: [String]) -> Bool {
        if keys.isEmpty { return day.date < context.today }
        let cdPast = day.cruiseDay.map(context.isPast) ?? true
        return cdPast && day.entries.allSatisfy(context.isPast)
    }
}

private struct DayHeaderRow: View {
    let day: TimelineDay
    let context: TimelineContext
    let allPast: Bool

    var body: some View {
        if let cd = day.cruiseDay {
            NavigationLink {
                CruiseDayDetailView(day: cd, edit: context.edit)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(Fmt.dayHeader(day.date)).font(.headline)
                        .opacity(allPast ? 0.45 : 1)
                    CruiseDaySummary(day: cd)
                        .opacity(context.isPast(cd) ? 0.45 : 1)
                }
                .padding(.vertical, 2)
            }
        } else {
            Text(Fmt.dayHeader(day.date))
                .font(.headline)
                .padding(.top, 4)
                .opacity(allPast ? 0.45 : 1)
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
