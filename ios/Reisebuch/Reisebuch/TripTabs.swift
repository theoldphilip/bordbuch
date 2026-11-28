//
//  TripTabs.swift
//  Reisebuch
//
//  Reiter einer Reise neben dem Ablauf (Auftrag 0.9.0, wie Trip.tsx): Kreuzfahrt (CruiseTab), Kosten (CostsTab.tsx) und Teilen (ShareTab).
//  Bearbeiten über die Formulare aus 0.6.0. Kosten offline aus dem Zwischenspeicher.
//

import SwiftUI

// MARK: - Kreuzfahrt

struct CruiseTabView: View {
    let detail: TripDetail?
    let edit: EditContext
    /// Einträge je Hafentag (Zahl, wie das 📌 der Web-App).
    let itemsPerDay: [String: Int]

    @State private var cruiseToEdit: CruiseSummary?
    @State private var newCruise = false
    @State private var dayFor: CruiseSummary?

    private var cruises: [CruiseSummary] { detail?.cruises ?? [] }

    var body: some View {
        List {
            if cruises.isEmpty {
                Section {
                    Text("Keine Kreuzfahrt").font(.headline)
                    Text("Lege Schiff, Kabine und Route an. Hafentage mit „Alle an Bord“-Zeiten werden dann im Ablauf angezeigt und geprüft.")
                        .foregroundStyle(.secondary)
                    if edit.canEdit { Button("Kreuzfahrt anlegen") { newCruise = true } }
                }
            }
            ForEach(cruises) { c in
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("🛳️ \(c.shipName ?? "Schiff")").font(.title3.bold())
                        if let cabin = c.cabin, !cabin.isEmpty { Text("🛏️ Kabine \(cabin)").bold() }
                        let line = [c.cruiseLine, c.bookingRef.map { "Buchung \($0)" }].compactMap { $0 }.filter { !$0.isEmpty }
                        if !line.isEmpty { Text(line.joined(separator: " · ")).foregroundStyle(.secondary) }
                        if let cost = c.cost {
                            Text("Preis \(Fmt.money(cost, c.currency)) · \(Labels.payment(c.paymentStatus))"
                                 + (c.paymentStatus == "deposit" && c.paidAmount != nil ? " (angezahlt \(Fmt.money(c.paidAmount!, c.currency)))" : "")
                                 + (c.dueDate.map { c.paymentStatus != "paid" ? " · fällig \(Fmt.local($0))" : "" } ?? ""))
                                .font(.subheadline)
                        }
                        if let notes = c.notes, !notes.isEmpty { Text(notes).font(.subheadline) }
                    }
                    if edit.canEdit { Button("Bearbeiten") { cruiseToEdit = c } }
                }
                if let infos = c.infos, !infos.isEmpty { InfoSection(infos: infos) }
                Section("Route") {
                    ForEach(c.days ?? []) { d in
                        NavigationLink {
                            CruiseDayDetailView(day: d, edit: edit)
                        } label: {
                            dayRow(d)
                        }
                    }
                    if edit.canEdit { Button("+ Reisetag") { dayFor = c } }
                }
            }
            if edit.canEdit && !cruises.isEmpty {
                Section { Button("+ Weitere Kreuzfahrt (Back-to-Back)") { newCruise = true } }
            }
        }
        .sheet(item: $cruiseToEdit) { c in CruiseFormView(cruise: c, ctx: edit) }
        .sheet(isPresented: $newCruise) { CruiseFormView(cruise: nil, ctx: edit) }
        .sheet(item: $dayFor) { c in CruiseDayFormView(cruise: c, ctx: edit) }
    }

    private func dayRow(_ d: CruiseDay) -> some View {
        let kind = Labels.dayKind(d.kind)
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(Fmt.dayHeader(d.date)).font(.subheadline.bold())
                if d.tender == true { Text("Tender").font(.caption2.bold()).padding(.horizontal, 5).background(Capsule().strokeBorder()) }
                if let n = itemsPerDay[d.id], n > 0 { Text("📌 \(n)").font(.caption) }
            }
            Text("\(kind.icon) \(d.kind == "sea" ? "Seetag" : (d.portName ?? kind.label))\(d.country.map { ", \($0)" } ?? "")")
            let times = [d.arrival.map { "An \($0)" }, d.departure.map { "\(d.kind == "disembarkation" ? "Von Bord bis" : "Ab") \($0)" },
                         d.allAboard.map { "An Bord \($0)" }].compactMap { $0 }
            if !times.isEmpty { Text(times.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
        }
    }
}

// MARK: - Kosten

struct CostsTabView: View {
    @Environment(AppSession.self) private var session
    let edit: EditContext
    let items: [String: Item]
    let onOpenCruise: () -> Void
    /// Ändert sich bei jeder Änderung der Reise; dann neu laden.
    let version: String

    @State private var costs: TripCosts?
    @State private var savedAt: Date?
    @State private var offline = false
    @State private var errorText: String?

    private var today: String { Fmt.todayISO() }

    var body: some View {
        List {
            if offline, let savedAt { OfflineBanner(savedAt: savedAt) }
            if let errorText { Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
            if let costs {
                content(costs)
            } else if errorText == nil {
                Section { ProgressView() }
            }
        }
        .refreshable { await load() }
        .task(id: version) { await load() }
    }

    @ViewBuilder
    private func content(_ c: TripCosts) -> some View {
        let byId = Dictionary(c.entries.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        if c.entries.isEmpty {
            Section {
                Text("Noch keine Preise erfasst").font(.headline)
                Text("Trage bei Einträgen und bei der Kreuzfahrt Kosten und Währung ein, dann erscheint hier die Übersicht je Währung und Art, mit bezahlt und offen.")
                    .foregroundStyle(.secondary)
            }
        }
        ForEach(c.currencies, id: \.currency) { cur in
            Section {
                HStack {
                    Text(cur.currency).font(.title3.bold())
                    Spacer()
                    Text(Fmt.money(cur.total, cur.currency)).font(.title3.bold())
                }
                HStack {
                    Text("bezahlt \(Text(Fmt.money(cur.paid, cur.currency)).bold())")
                    Spacer()
                    Text("offen \(Text(Fmt.money(cur.open, cur.currency)).bold())")
                        .foregroundStyle(cur.open > 0 ? Color.orange : Color.primary)
                }
                .font(.subheadline)
                if let u = cur.unstated, u > 0 {
                    Text(u == 1 ? "1 Betrag hat keine Angabe zur Zahlung und zählt als offen."
                                : "\(u) Beträge haben keine Angabe zur Zahlung und zählen als offen.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(cur.groups, id: \.kind) { g in
                    let info = CostLogic.kindLabel(g.kind, count: g.count)
                    DisclosureGroup {
                        ForEach(g.entryIds.compactMap { byId[$0] }) { e in entryRow(e) }
                    } label: {
                        HStack {
                            Text("\(info.icon) \(info.label) (\(g.count))")
                            Spacer()
                            Text(CostLogic.money(g.total, cur.currency)).monospacedDigit()
                        }
                    }
                }
            }
        }
        if !c.due.isEmpty {
            Section("Noch zu zahlen") {
                ForEach(c.due) { e in
                    open(e) {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(e.title)
                                if let due = e.dueDate {
                                    Text(CostLogic.dueText(due, today: today)).font(.caption.bold())
                                        .foregroundStyle(CostLogic.isOverdue(due, today: today) ? Color.red : Color.secondary)
                                }
                            }
                            Spacer()
                            Text(CostLogic.money(e.open, e.currency)).monospacedDigit()
                        }
                    }
                }
            }
        }
        if !c.withoutCurrency.isEmpty {
            Section {
                ForEach(c.withoutCurrency) { e in entryRow(e) }
            } header: {
                Text("Ohne Währung")
            } footer: {
                Text("Diese Beträge sind in keiner Summe enthalten. Trage die Währung nach, dann zählen sie mit.")
            }
        }
        if !c.missingPrice.isEmpty {
            Section {
                ForEach(c.missingPrice, id: \.kind) { m in
                    let info = CostLogic.kindLabel(m.kind, count: m.count)
                    DisclosureGroup {
                        ForEach(m.entryIds, id: \.self) { id in
                            if m.kind == "cruise" {
                                Button(edit.cruises.first { $0.id == id }?.shipName ?? "Kreuzfahrt") { onOpenCruise() }
                            } else if let item = items[id] {
                                NavigationLink(item.title) { detail(item) }
                            }
                        }
                    } label: {
                        HStack { Text("\(info.icon) \(info.label)"); Spacer(); Text("\(m.count)").foregroundStyle(.secondary) }
                    }
                }
            } header: {
                Text("Ohne Preis")
            } footer: {
                Text("Gebuchte Leistungen, bei denen noch kein Preis steht.")
            }
        }
    }

    private func entryRow(_ e: CostEntry) -> some View {
        open(e) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.title)
                    Text([e.date.map { Fmt.local($0) }, CostLogic.paymentText(e)].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(e.paymentStatus == "paid" ? Color.green : Color.secondary)
                }
                Spacer()
                Text(CostLogic.money(e.cost, e.currency)).monospacedDigit()
            }
        }
    }

    /// Antippen öffnet den Eintrag bzw. wechselt zur Kreuzfahrt.
    @ViewBuilder
    private func open(_ e: CostEntry, @ViewBuilder label: () -> some View) -> some View {
        if e.source == "cruise" {
            Button { onOpenCruise() } label: { label() }.foregroundStyle(.primary)
        } else if let item = items[e.id] {
            NavigationLink { detail(item) } label: { label() }
        } else {
            label()
        }
    }

    private func detail(_ item: Item) -> some View {
        ItemDetailView(item: item, warnings: [], tripRole: edit.isEditor ? "editor" : "viewer", onChanged: edit.reload, edit: edit)
    }

    private func load() async {
        if costs == nil, let entry = ResponseCache.load(ResponseCache.costsFile(edit.tripId)),
           let cached = try? APIClient.decode(TripCosts.self, from: entry.data) {
            costs = cached
            savedAt = entry.savedAt
        }
        do {
            let result = try await session.call { try await $0.costsRaw(tripId: edit.tripId) }
            ResponseCache.save(result.data, as: ResponseCache.costsFile(edit.tripId))
            costs = result.costs
            offline = false
            errorText = nil
        } catch APIError.unreachable {
            offline = costs != nil
            if costs == nil { errorText = APIError.unreachable.localizedDescription }
        } catch is CancellationError {
            return
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

// MARK: - Teilen

struct ShareTabView: View {
    @Environment(AppSession.self) private var session
    let tripId: String
    let members: [Member]
    let myRole: String?
    let onChanged: () async -> Void
    let onLeft: () -> Void

    @State private var users: [User] = []
    @State private var addId = ""
    @State private var addRole = "editor"
    @State private var errorText: String?
    @State private var toRemove: Member?
    @State private var confirmLeave = false

    var body: some View {
        List {
            if let errorText { Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) } }
            Section {
                ForEach(members) { m in
                    HStack {
                        Text(m.displayName)
                        if m.userId == session.userId { Text("(du)").foregroundStyle(.secondary) }
                        Spacer()
                        if ShareRights.canManage(myRole: myRole, member: m, myId: session.userId) {
                            Picker("Rolle", selection: Binding(get: { m.role }, set: { r in Task { await setRole(m, r) } })) {
                                ForEach(ShareRights.roleLabels, id: \.role) { Text($0.label).tag($0.role) }
                            }
                            .labelsHidden()
                        } else {
                            Text(ShareRights.label(m.role)).foregroundStyle(.secondary)
                        }
                    }
                    .swipeActions {
                        if ShareRights.canManage(myRole: myRole, member: m, myId: session.userId) {
                            Button("Entfernen", role: .destructive) { toRemove = m }
                        }
                    }
                }
            } header: {
                Text("Mitreisende")
            } footer: {
                Text("Besitzer verwalten die Mitreisenden und können die Reise löschen. „Bearbeiten“ darf Einträge, Kreuzfahrt und Dokumente ändern. „Nur ansehen“ liest alles, ändert nichts.")
            }
            if ShareRights.canAdd(myRole: myRole) {
                let candidates = ShareRights.candidates(users: users, members: members)
                Section("Hinzufügen") {
                    if candidates.isEmpty {
                        Text("Weitere Familienmitglieder legst du unter Einstellungen → Familie an.").foregroundStyle(.secondary)
                    } else {
                        Picker("Familienmitglied", selection: $addId) {
                            Text("wählen …").tag("")
                            ForEach(candidates, id: \.id) { Text($0.displayName).tag($0.id) }
                        }
                        Picker("Rolle", selection: $addRole) {
                            Text("Bearbeiten").tag("editor")
                            Text("Nur ansehen").tag("viewer")
                        }
                        Button("Hinzufügen") { Task { await add() } }.disabled(addId.isEmpty)
                    }
                }
            }
            if ShareRights.canLeave(myRole: myRole, members: members) {
                Section { Button("Reise verlassen", role: .destructive) { confirmLeave = true } }
            }
        }
        .task { users = (try? await session.call { try await $0.users() }) ?? [] }
        .confirmationDialog("\(toRemove?.displayName ?? "") aus der Reise entfernen?",
                            isPresented: Binding(get: { toRemove != nil }, set: { if !$0 { toRemove = nil } }), titleVisibility: .visible) {
            Button("Entfernen", role: .destructive) { if let m = toRemove { Task { await remove(m) } } }
        }
        .confirmationDialog("Diese Reise verlassen?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Reise verlassen", role: .destructive) { Task { await leave() } }
        } message: {
            Text("Du siehst sie danach nicht mehr, bis dich jemand wieder hinzufügt.")
        }
    }

    private func run(_ work: () async throws -> Void) async {
        errorText = nil
        do {
            try await work()
            await onChanged()
        } catch {
            errorText = SaveError.text(error)
        }
    }

    private func setRole(_ m: Member, _ role: String) async {
        await run { try await session.call { try await $0.setMember(tripId: tripId, userId: m.userId, role: role) } }
    }

    private func add() async {
        let id = addId
        await run { try await session.call { try await $0.setMember(tripId: tripId, userId: id, role: addRole) } }
        addId = ""
    }

    private func remove(_ m: Member) async {
        await run { try await session.call { try await $0.removeMember(tripId: tripId, userId: m.userId) } }
    }

    private func leave() async {
        guard let me = session.userId else { return }
        errorText = nil
        do {
            try await session.call { try await $0.removeMember(tripId: tripId, userId: me) }
            _ = try? await session.fetchTrips()
            onLeft()
        } catch {
            errorText = SaveError.text(error)
        }
    }
}

// ENDE TripTabs.swift
