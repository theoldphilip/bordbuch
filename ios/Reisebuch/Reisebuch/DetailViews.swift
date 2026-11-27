//
//  DetailViews.swift
//  Reisebuch
//
//  Detailansichten (nur lesen) für Eintrag und Kreuzfahrt-Tag, dazu die Zusatzinfos mit Anruf-Links.
//

import SwiftUI

// MARK: - Eintrag

struct ItemDetailView: View {
    @Environment(AppSession.self) private var session
    /// Lokal veränderbar: Nach „Übernehmen“ der Reisetag-Abfrage zeigt die Ansicht gleich den neuen Stand.
    @State private var item: Item
    let warnings: [TimelineWarning]
    let tripRole: String?
    let onChanged: () async -> Void

    init(item: Item, warnings: [TimelineWarning], tripRole: String? = nil, onChanged: @escaping () async -> Void = {}) {
        _item = State(initialValue: item)
        self.warnings = warnings
        self.tripRole = tripRole
        self.onChanged = onChanged
    }

    /// Reisetag-Abfrage nur für Flug, Zug, Mietwagen, wenn der Server sie anbietet und man in der Reise bearbeiten darf.
    private var showsPlaceLookup: Bool {
        ["flight", "train", "car_rental"].contains(item.type)
            && session.placeLookupAvailable
            && (tripRole == "owner" || tripRole == "editor")
    }

    var body: some View {
        let type = Labels.itemType(item.type)
        let place = Labels.placeLine(item)
        Form {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(type.icon) \(type.label)").font(.subheadline).foregroundStyle(.secondary)
                    Text(item.title).font(.title3.bold())
                    if !place.isEmpty {
                        Text(place).font(.headline)
                    }
                }
                .padding(.vertical, 2)
            }

            if showsPlaceLookup {
                PlaceLookupSection(item: $item, onChanged: onChanged)
            }

            if !warnings.isEmpty {
                Section("Hinweise") {
                    ForEach(Array(warnings.enumerated()), id: \.offset) { _, w in
                        WarningRow(warning: w)
                    }
                }
            }

            Section("Zeit") {
                TimeRow(label: Labels.startLabel(item.type) ?? "Beginn", local: item.startLocal, tz: item.startTz)
                if let end = item.endLocal, !end.isEmpty {
                    TimeRow(label: Labels.endLabel(item.type) ?? "Ende", local: end, tz: item.endTz ?? item.startTz)
                }
            }

            let booking = bookingRows
            if !booking.isEmpty {
                Section("Buchung") {
                    ForEach(booking, id: \.0) { label, value in
                        LabeledContent(label) { Text(value).textSelection(.enabled).multilineTextAlignment(.trailing) }
                    }
                }
            }

            let details = sortedDetails
            if !details.isEmpty {
                Section("Details") {
                    ForEach(details, id: \.0) { key, value in
                        if Labels.isPhoneDetail(key), let url = Fmt.telURL(value) {
                            LabeledContent(Labels.detailKey(key)) {
                                Link(value, destination: url)
                            }
                        } else {
                            LabeledContent(Labels.detailKey(key)) {
                                Text(Labels.detailValue(key: key, value: value))
                                    .textSelection(.enabled)
                                    .multilineTextAlignment(.trailing)
                            }
                        }
                    }
                }
            }

            InfoSection(infos: item.infos ?? [])

            if let notes = item.notes, !notes.isEmpty {
                Section("Notizen") {
                    Text(notes).textSelection(.enabled)
                }
            }
        }
        .navigationTitle(type.label)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var bookingRows: [(String, String)] {
        var rows: [(String, String)] = []
        if let v = item.location, !v.isEmpty { rows.append(("Ort", v)) }
        if let v = item.provider, !v.isEmpty { rows.append(("Anbieter", v)) }
        if let v = item.confirmation, !v.isEmpty { rows.append(("Buchungsnummer", v)) }
        if let cost = item.cost {
            rows.append(("Preis", Fmt.money(cost, item.currency)))
            rows.append(("Zahlung", Labels.payment(item.paymentStatus)))
            if item.paymentStatus == "deposit", let paid = item.paidAmount {
                rows.append(("Angezahlt", Fmt.money(paid, item.currency)))
            }
        }
        if let due = item.dueDate, !due.isEmpty { rows.append(("Fällig", Fmt.local(due))) }
        return rows
    }

    /// Ortsfelder stehen schon oben; die übrigen Details in fester Reihenfolge, Unbekanntes alphabetisch dahinter.
    private var sortedDetails: [(String, String)] {
        let order = ["airline", "flightNumber", "trainNumber", "from", "to", "terminal", "checkinDesk", "gate", "baggageBelt",
                     "platform", "desk", "seat", "cabin", "mode", "carClass", "returnLocation", "room", "breakfast", "lot",
                     "plate", "shuttle", "meetingPoint", "bookedVia", "guests", "country", "address", "phone"]
        let money: Set<String> = ["paymentStatus", "paidAmount", "dueDate"]
        let entries = item.detailMap.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty && !money.contains($0.key) }
        return entries.sorted { a, b in
            let ia = order.firstIndex(of: a.key) ?? Int.max
            let ib = order.firstIndex(of: b.key) ?? Int.max
            return ia == ib ? a.key < b.key : ia < ib
        }.map { ($0.key, $0.value) }
    }
}

private struct TimeRow: View {
    let label: String
    let local: String
    let tz: String?

    var body: some View {
        LabeledContent(label) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(Fmt.local(local))
                if let zone = Fmt.zoneLabel(tz, on: local) {
                    Text(zone).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Kreuzfahrt-Tag

struct CruiseDayDetailView: View {
    let day: CruiseDay

    var body: some View {
        let kind = Labels.dayKind(day.kind)
        Form {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(kind.icon) \(kind.label)").font(.subheadline).foregroundStyle(.secondary)
                    Text(Fmt.local(day.date)).font(.title3.bold())
                    if let port = day.portName, !port.isEmpty {
                        Text([port, day.country].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "))
                            .font(.headline)
                    }
                }
                .padding(.vertical, 2)
            }

            Section("Zeiten (Ortszeit)") {
                if let v = day.arrival, !v.isEmpty { LabeledContent("Ankunft", value: v) }
                if let v = day.departure, !v.isEmpty { LabeledContent("Abfahrt", value: v) }
                if let v = day.allAboard, !v.isEmpty {
                    LabeledContent("Alle an Bord") {
                        Text(v).bold().foregroundStyle(.orange)
                    }
                }
                if day.tender == true { LabeledContent("Hafen", value: "Tenderhafen") }
                if let zone = Fmt.zoneLabel(day.timezone, on: day.date) {
                    LabeledContent("Zeitzone", value: zone)
                }
            }

            InfoSection(infos: day.infos ?? [])

            if let notes = day.notes, !notes.isEmpty {
                Section("Notizen") { Text(notes).textSelection(.enabled) }
            }
        }
        .navigationTitle(kind.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Zusatzinfos

struct InfoSection: View {
    let infos: [Info]

    var body: some View {
        if !infos.isEmpty {
            Section("Zusatzinfos") {
                ForEach(Array(infos.enumerated()), id: \.offset) { _, info in
                    InfoRow(info: info)
                }
            }
        }
    }
}

private struct InfoRow: View {
    let info: Info

    private var needsCheck: Bool { info.source == "ai" || info.source == "web" }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if info.kind == "emergency" {
                    Image(systemName: "staroflife.fill").foregroundStyle(.red)
                }
                Text(info.label).font(.subheadline).foregroundStyle(.secondary)
                if needsCheck {
                    Text("bitte prüfen")
                        .font(.caption2.bold())
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().strokeBorder(Color.orange))
                }
            }
            value
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var value: some View {
        switch info.kind {
        case "phone", "emergency":
            if let url = Fmt.telURL(info.value) {
                Link(destination: url) { Label(info.value, systemImage: "phone.fill") }
            } else {
                Text(info.value)
            }
        case "email":
            let address = info.value.trimmingCharacters(in: .whitespaces)
            if let url = URL(string: "mailto:\(address)") {
                Link(destination: url) { Label(address, systemImage: "envelope.fill") }
            } else {
                Text(info.value)
            }
        case "link":
            if let url = linkURL(info.value) {
                Link(destination: url) { Label(info.value, systemImage: "link") }
            } else {
                Text(info.value)
            }
        default:
            Text(info.value).textSelection(.enabled)
        }
    }

    private func linkURL(_ text: String) -> URL? {
        let t = text.trimmingCharacters(in: .whitespaces)
        let lower = t.lowercased()
        let full = lower.hasPrefix("http://") || lower.hasPrefix("https://") ? t : "https://" + t
        guard let url = URL(string: full), url.host() != nil else { return nil }
        return url
    }
}

// ENDE DetailViews.swift
