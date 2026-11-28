//
//  EditForms.swift
//  Reisebuch
//
//  Formulare zum Bearbeiten (Auftrag 0.6.0): Eintrag, Reise, Kreuzfahrt, Reisetag. Felder, Texte und Vorbelegung wie in der Web-App
//  (ItemForm.tsx, MoneyFields.tsx, InfoEditor.tsx, CruiseForms.tsx). Fehler stehen im Formular, nie als Dialog. Offline wird nichts
//  gespeichert, die Eingaben bleiben stehen.
//

import SwiftUI

/// Was die Formulare einer Reise brauchen.
struct EditContext {
    let tripId: String
    /// Aktueller Titel (für die Übernahme des Namensvorschlags der KI).
    var tripTitle: String = ""
    let tripKind: String?
    let cruises: [CruiseSummary]
    let defaultTz: String
    /// Vorbelegung der Zeitzone neuer Einträge (Zone des letzten Eintrags im Ablauf, sonst Standard der Reise).
    let suggestedTz: String
    let isEditor: Bool
    let isOwner: Bool
    /// Bearbeiter und nicht im Ansichtsmodus.
    let canEdit: Bool
    /// Nach Speichern oder Löschen: Ablauf und Detail neu laden (Cache, Widget, Orte).
    let reload: () async -> Void

    var allDays: [(day: CruiseDay, ship: String)] {
        cruises.flatMap { c in (c.days ?? []).map { (day: $0, ship: c.shipName ?? "") } }
    }
}

enum SaveError {
    static func text(_ error: Error) -> String {
        if case APIError.unreachable = error { return "Offline, Änderung nicht gespeichert." }
        return error.localizedDescription
    }
}

// MARK: - Bausteine

/// Datum, das leer sein darf.
struct OptionalDateField: View {
    let label: String
    @Binding var date: String?
    var fallback: String? = nil

    var body: some View {
        if let current = date, let value = LocalTime.date(from: current) {
            HStack {
                DatePicker(label, selection: Binding(get: { value }, set: { date = LocalTime.text(fromDate: $0) }),
                           displayedComponents: .date)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                Button { date = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("\(label) entfernen")
            }
        } else {
            Button("\(label) wählen") {
                date = fallback ?? LocalTime.text(fromDate: Date())
            }
        }
    }
}

/// Uhrzeit, die leer sein darf (dann gilt nur das Datum).
struct OptionalTimeField: View {
    let label: String
    @Binding var time: String?

    var body: some View {
        if let current = time, let value = LocalTime.time(from: current) {
            HStack {
                DatePicker(label, selection: Binding(get: { value }, set: { time = LocalTime.text(fromTime: $0) }),
                           displayedComponents: .hourAndMinute)
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
                Button { time = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("\(label) entfernen")
            }
        } else {
            Button("\(label) angeben") { time = "12:00" }
        }
    }
}

/// Zeitzone mit Suche; leer = Standard.
struct TimezoneField: View {
    let label: String
    @Binding var tz: String
    var placeholder = "Standard"

    var body: some View {
        NavigationLink {
            TimezonePicker(selection: $tz, placeholder: placeholder)
        } label: {
            LabeledContent(label, value: tz.isEmpty ? placeholder : tz)
        }
    }
}

private struct TimezonePicker: View {
    @Binding var selection: String
    let placeholder: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private static let common = ["Europe/Zurich", "Europe/Berlin", "Europe/Rome", "Europe/Paris", "Europe/Madrid", "Europe/Lisbon",
                                 "Europe/London", "Europe/Athens", "Europe/Istanbul", "America/New_York", "Asia/Dubai"]

    private var zones: [String] {
        let all = Self.common + TimeZone.knownTimeZoneIdentifiers.filter { !Self.common.contains($0) }.sorted()
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? all : all.filter { $0.lowercased().replacingOccurrences(of: "_", with: " ").contains(q) || $0.lowercased().contains(q) }
    }

    var body: some View {
        List {
            if search.isEmpty {
                Button {
                    selection = ""
                    dismiss()
                } label: {
                    HStack {
                        Text("Standard (\(placeholder))")
                        Spacer()
                        if selection.isEmpty { Image(systemName: "checkmark") }
                    }
                }
            }
            ForEach(zones, id: \.self) { zone in
                Button {
                    selection = zone
                    dismiss()
                } label: {
                    HStack {
                        Text(zone.replacingOccurrences(of: "_", with: " "))
                        Spacer()
                        if selection == zone { Image(systemName: "checkmark") }
                    }
                }
            }
        }
        .foregroundStyle(.primary)
        .searchable(text: $search, prompt: "Stadt oder Region")
        .navigationTitle("Zeitzone")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Preis, Währung und Zahlung (MoneyFields.tsx).
struct MoneyState {
    var cost = ""
    var currency = ""
    var status = ""
    var paid = ""
    var due: String?

    init() {}

    init(cost: Double?, currency: String?, status: String?, paid: Double?, due: String?) {
        self.cost = MoneyInput.text(cost)
        self.currency = currency ?? ""
        self.status = status ?? ""
        self.paid = MoneyInput.text(paid)
        self.due = due
    }

    func build() -> (value: MoneyInput.Value?, error: String?) {
        MoneyInput.build(cost: cost, currency: currency, status: status, paid: paid, due: due)
    }
}

struct MoneyFields: View {
    @Binding var money: MoneyState

    var body: some View {
        TextField("Kosten", text: $money.cost).keyboardType(.decimalPad)
        TextField("Währung (z. B. EUR)", text: Binding(get: { money.currency },
                                                      set: { money.currency = String($0.uppercased().prefix(3)) }))
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
        if !money.cost.trimmingCharacters(in: .whitespaces).isEmpty {
            Picker("Zahlung", selection: $money.status) {
                Text("keine Angabe").tag("")
                ForEach(ItemKinds.paymentStatuses, id: \.status) { Text($0.label).tag($0.status) }
            }
            if money.status == "deposit" {
                TextField("Bereits angezahlt", text: $money.paid).keyboardType(.decimalPad)
            }
            if money.status != "paid" {
                OptionalDateField(label: money.status == "deposit" ? "Rest fällig am" : "Fällig am", date: $money.due)
            }
        }
    }
}

/// Zusatzinfos bearbeiten (InfoEditor.tsx): Text ändern macht eine KI-/Web-Angabe zur eigenen.
struct InfoEditorSection: View {
    let title: String
    @Binding var infos: [Info]

    var body: some View {
        Section {
            ForEach(Array(infos.enumerated()), id: \.offset) { n, info in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Picker("Art", selection: Binding(get: { info.kind }, set: { set(n, kind: $0) })) {
                            ForEach(ItemKinds.infoKinds, id: \.kind) { Text($0.label).tag($0.kind) }
                        }
                        .labelsHidden()
                        Spacer()
                        Button(role: .destructive) { infos.remove(at: n) } label: { Image(systemName: "trash") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Info entfernen")
                    }
                    TextField("Bezeichnung, z. B. Rezeption", text: Binding(get: { info.label }, set: { set(n, label: $0) }))
                    TextField(info.kind == "text" ? "Hinweis" : info.kind == "email" ? "name@beispiel.ch" : info.kind == "link" ? "https://…" : "+39 06 1234 567",
                              text: Binding(get: { info.value }, set: { set(n, value: $0) }))
                        .keyboardType(info.kind == "phone" || info.kind == "emergency" ? .phonePad : .default)
                        .textInputAutocapitalization(info.kind == "text" ? .sentences : .never)
                    if info.source == "ai" || info.source == "web" {
                        Text(info.source == "ai" ? "KI-Wissen, bitte prüfen" : "Web-Recherche, bitte prüfen")
                            .font(.caption).foregroundStyle(.orange)
                    }
                }
            }
            HStack {
                Button("+ Notruf") { infos.append(Info(label: "Notruf", value: "", kind: "emergency", source: "user")) }
                Button("+ Telefon") { infos.append(Info(label: "", value: "", kind: "phone", source: "user")) }
                Button("+ Hinweis") { infos.append(Info(label: "", value: "", kind: "text", source: "user")) }
            }
            .buttonStyle(.borderless)
        } header: {
            Text(title)
        }
    }

    private func set(_ n: Int, kind: String? = nil, label: String? = nil, value: String? = nil) {
        let old = infos[n]
        let textChanged = label != nil || value != nil
        infos[n] = Info(label: label ?? old.label, value: value ?? old.value, kind: kind ?? old.kind,
                        source: textChanged ? "user" : old.source)
    }
}

/// Fehlerzeile oben im Formular.
struct FormErrorSection: View {
    let error: String?

    var body: some View {
        if let error {
            Section {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
            }
        }
    }
}

// MARK: - Eintrag

struct ItemFormView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    let ctx: EditContext
    let original: Item?
    /// Gesetzt beim Bearbeiten eines KI-Vorschlags: gibt die Daten zurück, statt zu speichern.
    let onSubmit: (([String: JSONValue]) -> Void)?
    let onSaved: (Item) -> Void

    @State private var type: String
    @State private var title: String
    @State private var startDate: String?
    @State private var startTime: String?
    @State private var startTz: String
    @State private var endDate: String?
    @State private var endTime: String?
    @State private var endTz: String
    @State private var location: String
    @State private var provider: String
    @State private var confirmation: String
    @State private var money: MoneyState
    @State private var notes: String
    @State private var cruiseDayId: String
    @State private var infos: [Info]
    @State private var details: [String: String]
    @State private var error: String?
    @State private var busy = false

    init(ctx: EditContext, item: Item? = nil, initialType: String? = nil, onSubmit: (([String: JSONValue]) -> Void)? = nil,
         onSaved: @escaping (Item) -> Void) {
        self.ctx = ctx
        self.original = item
        self.onSubmit = onSubmit
        self.onSaved = onSaved
        let t = item?.type ?? initialType ?? "flight"
        let s = LocalTime.split(item?.startLocal)
        let e = LocalTime.split(item?.endLocal)
        _type = State(initialValue: t)
        _title = State(initialValue: item?.title ?? "")
        _startDate = State(initialValue: s.date)
        _startTime = State(initialValue: s.time)
        _startTz = State(initialValue: item.map { $0.startTz ?? "" } ?? ctx.suggestedTz)
        _endDate = State(initialValue: e.date)
        _endTime = State(initialValue: e.time)
        _endTz = State(initialValue: item?.endTz ?? "")
        _location = State(initialValue: item?.location ?? "")
        _provider = State(initialValue: item?.provider ?? "")
        _confirmation = State(initialValue: item?.confirmation ?? "")
        _money = State(initialValue: item.map { MoneyState(cost: $0.cost, currency: $0.currency, status: $0.paymentStatus,
                                                           paid: $0.paidAmount, due: $0.dueDate) }
                       ?? { var m = MoneyState(); m.currency = MoneyInput.lastCurrency; return m }())
        _notes = State(initialValue: item?.notes ?? "")
        _cruiseDayId = State(initialValue: item?.cruiseDayId ?? "")
        _infos = State(initialValue: item?.infos ?? [])
        _details = State(initialValue: item?.detailMap ?? (t == "excursion" ? ["bookedVia": "ship"] : [:]))
    }

    private var isTransport: Bool { ItemKinds.transport.contains(type) }
    private var showEnd: Bool { ItemKinds.hasEnd.contains(type) }
    private var canLink: Bool { !ctx.allDays.isEmpty && ItemKinds.linkable.contains(type) }

    var body: some View {
        NavigationStack {
            Form {
                FormErrorSection(error: error)
                if original == nil {
                    Section("Art") {
                        Picker("Art", selection: $type) {
                            ForEach(ItemKinds.available(tripKind: ctx.tripKind, hasCruises: !ctx.cruises.isEmpty), id: \.self) { t in
                                let k = Labels.itemType(t)
                                Text("\(k.icon) \(k.label)").tag(t)
                            }
                        }
                        .pickerStyle(.navigationLink)
                        .onChange(of: type) { _, t in
                            if t == "excursion", details["bookedVia"] == nil { details["bookedVia"] = "ship" }
                        }
                    }
                }
                Section {
                    TextField(ItemKinds.titlePlaceholder(type).isEmpty ? "Titel" : "Titel, z. B. \(ItemKinds.titlePlaceholder(type))",
                              text: $title)
                    if canLink {
                        Picker("Kreuzfahrt-Tag", selection: $cruiseDayId) {
                            Text("kein Kreuzfahrt-Tag").tag("")
                            ForEach(ctx.allDays, id: \.day.id) { d in
                                Text(dayText(d.day)).tag(d.day.id)
                            }
                        }
                        .onChange(of: cruiseDayId) { _, id in pickDay(id) }
                    }
                }
                Section {
                    OptionalDateField(label: "\(Labels.startLabel(type) ?? "Beginn") – Datum", date: $startDate)
                    OptionalTimeField(label: "Uhrzeit", time: $startTime)
                    TimezoneField(label: isTransport ? "Zeitzone Abflug/Abfahrt" : "Zeitzone", tz: $startTz,
                                  placeholder: linkedDay?.timezone ?? ctx.defaultTz)
                } header: {
                    Text(Labels.startLabel(type) ?? "Beginn")
                } footer: {
                    Text("Ortszeit, so wie sie auf der Buchung steht. Leer = Zeitzone des Hafens bzw. Standard.")
                }
                if showEnd {
                    Section(Labels.endLabel(type) ?? "Ende") {
                        OptionalDateField(label: "\(Labels.endLabel(type) ?? "Ende") – Datum", date: $endDate, fallback: startDate)
                        OptionalTimeField(label: "Uhrzeit", time: $endTime)
                        if isTransport {
                            TimezoneField(label: "Zeitzone Ankunft", tz: $endTz, placeholder: startTz.isEmpty ? ctx.defaultTz : startTz)
                        }
                    }
                }
                let fields = ItemKinds.detailFields[type] ?? []
                if type == "excursion" || !fields.isEmpty {
                    Section("Details") {
                        if type == "excursion" {
                            Picker("Gebucht über", selection: detailBinding("bookedVia")) {
                                Text("Reederei").tag("ship")
                                Text("Privat").tag("private")
                            }
                            .pickerStyle(.segmented)
                        }
                        ForEach(fields, id: \.key) { f in
                            LabeledContent(f.label) {
                                TextField(f.placeholder, text: detailBinding(f.key))
                                    .multilineTextAlignment(.trailing)
                                    .autocorrectionDisabled()
                            }
                        }
                    }
                }
                if type != "note" {
                    Section("Buchung") {
                        TextField(type == "hotel" ? "Adresse" : "Ort", text: $location)
                        TextField(type == "excursion" ? "Anbieter, z. B. GetYourGuide" : "Anbieter", text: $provider)
                        TextField("Buchungsnummer", text: $confirmation).autocorrectionDisabled()
                    }
                    Section("Preis") {
                        MoneyFields(money: $money)
                    }
                }
                InfoEditorSection(title: "Zusatzinfos", infos: $infos)
                Section("Notizen") {
                    TextField("Notizen", text: $notes, axis: .vertical).lineLimit(3...8)
                }
            }
            .navigationTitle(onSubmit != nil ? "Vorschlag bearbeiten" : original == nil ? "Neuer Eintrag" : "Eintrag bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button(onSubmit != nil ? "Fertig" : "Speichern") { Task { await save() } } }
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private var linkedDay: CruiseDay? { ctx.allDays.first { $0.day.id == cruiseDayId }?.day }

    private func dayText(_ d: CruiseDay) -> String {
        let kind = Labels.dayKind(d.kind).label
        let port = d.portName.map { $0.isEmpty ? "" : " · \($0)" } ?? ""
        return "\(Fmt.dayHeader(d.date)) · \(kind)\(port)"
    }

    private func pickDay(_ id: String) {
        guard let day = ctx.allDays.first(where: { $0.day.id == id })?.day else { return }
        startDate = day.date
        if let end = endDate, end < day.date { endDate = day.date }
        if startTz.isEmpty || startTz == ctx.suggestedTz, let tz = day.timezone { startTz = tz }
    }

    private func detailBinding(_ key: String) -> Binding<String> {
        Binding(get: { details[key] ?? "" }, set: { details[key] = $0 })
    }

    /// Alles, was das Formular schickt (wie ItemForm.tsx), `details` verlustfrei zusammengeführt.
    private func payload() -> (body: [String: JSONValue]?, error: String?) {
        if title.trimmingCharacters(in: .whitespaces).isEmpty { return (nil, "Bitte einen Titel eingeben.") }
        guard let start = LocalTime.join(date: startDate, time: startTime) else { return (nil, "Bitte ein Datum angeben.") }
        let m: MoneyInput.Value
        if type == "note" {
            m = MoneyInput.none
        } else {
            let built = money.build()
            guard let v = built.value else { return (nil, built.error) }
            m = v
        }
        let endDay = endDate ?? (endTime != nil ? startDate : nil)
        let mergedDetails = EditMerge.details(original: original?.details?.raw ?? [:], form: details,
                                              knownKeys: ItemKinds.formKeys(type))
        var body: [String: JSONValue] = [
            "type": .string(type),
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "startLocal": .string(start),
            "startTz": EditMerge.text(startTz),
            "endLocal": showEnd ? EditMerge.text(LocalTime.join(date: endDay, time: endTime)) : .null,
            "endTz": showEnd && isTransport ? EditMerge.text(endTz) : .null,
            "location": EditMerge.text(location),
            "provider": EditMerge.text(provider),
            "confirmation": EditMerge.text(confirmation),
            "notes": EditMerge.text(notes),
            "cruiseDayId": canLink && !cruiseDayId.isEmpty ? .string(cruiseDayId) : .null,
            "details": .object(mergedDetails),
            "infos": EditMerge.infos(infos),
        ]
        body.merge(m.json) { _, new in new }
        MoneyInput.remember(m.currency)
        return (body, nil)
    }

    private func save() async {
        error = nil
        let p = payload()
        guard var body = p.body else { error = p.error; return }
        if let onSubmit {
            // Vorschlag: nur im Speicher ersetzen, gesendet wird erst mit „Übernehmen“.
            onSubmit(body)
            dismiss()
            return
        }
        busy = true
        defer { busy = false }
        do {
            let saved: Item
            if let original {
                body = EditMerge.changed(original: EditMerge.payload(of: original), new: body)
                if body.isEmpty { dismiss(); return }
                saved = try await session.call { try await $0.patchItem(itemId: original.id, body) }
            } else {
                saved = try await session.call { try await $0.createItem(tripId: ctx.tripId, body) }
            }
            await ctx.reload()
            onSaved(saved)
            dismiss()
        } catch {
            self.error = SaveError.text(error)
        }
    }
}

// MARK: - Reise

/// Neue Reise (von Hand oder aus Dokumenten wie Trips.tsx) bzw. Reise bearbeiten.
struct TripFormView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    let original: TripInfo?
    let onSaved: (TripInfo) -> Void

    @State private var title: String
    @State private var kind: String
    @State private var startDate: String?
    @State private var endDate: String?
    @State private var notes: String
    @State private var error: String?
    @State private var busy = false
    /// "ai" = aus Dokumenten, "manual" = von Hand (nur bei neuer Reise).
    @State private var mode = "manual"
    @State private var modeChosen = false
    @State private var files: [PendingFile] = []
    @State private var grouped = false
    @State private var progress: String?
    /// Reise ist angelegt, aber nicht alles ließ sich hochladen: „Zur Reise“ statt erneut anlegen.
    @State private var created: TripInfo?

    init(trip: TripInfo? = nil, onSaved: @escaping (TripInfo) -> Void) {
        original = trip
        self.onSaved = onSaved
        _title = State(initialValue: trip?.title ?? "")
        _kind = State(initialValue: trip?.kind ?? "cruise")
        _startDate = State(initialValue: trip?.startDate)
        _endDate = State(initialValue: trip?.endDate)
        _notes = State(initialValue: trip?.notes ?? "")
    }

    private var aiAvailable: Bool { original == nil && AIFeatures(status: session.aiStatus, role: nil).aiImport }
    private var aiMode: Bool { aiAvailable && mode == "ai" }

    var body: some View {
        NavigationStack {
            Form {
                FormErrorSection(error: error)
                if aiAvailable {
                    Section {
                        Picker("Weg", selection: $mode) {
                            Text("Aus Dokumenten").tag("ai")
                            Text("Von Hand").tag("manual")
                        }
                        .pickerStyle(.segmented)
                        .disabled(busy || created != nil)
                    }
                }
                if aiMode {
                    Section {
                        Text("Lade die Buchungen oder den Reiseplan hoch (Kreuzfahrt, Flüge, Hotels, Mietwagen, Parkplatz, Transfers, Programm einer Rundreise). Die KI baut daraus die Reise auf. Du prüfst alles, bevor etwas gespeichert wird.")
                            .font(.subheadline)
                    }
                    InputCollectorSection(files: $files, grouped: $grouped, disabled: busy || created != nil)
                    Section {
                        Text("Die Dokumente werden zur Analyse an den eingestellten KI-Anbieter gesendet.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    TextField(aiMode ? "Name (optional, sonst schlägt ihn die KI vor)" : "Titel, z. B. Mittelmeer Mai 2027", text: $title)
                }
                Section {
                    if aiMode {
                        kindRow(kind: "auto", label: "Automatisch erkennen", icon: "✨", hint: "Nach den hochgeladenen Dokumenten")
                    }
                    ForEach(ItemKinds.tripKinds, id: \.kind) { k in
                        kindRow(kind: k.kind, label: k.label, icon: k.icon, hint: k.hint)
                    }
                } header: {
                    Text("Art der Reise")
                } footer: {
                    if kind == "auto" {
                        Text("Die App erkennt aus den Dokumenten, ob es eine Kreuzfahrt, ein Städtetrip oder eine Rundreise ist. Du kannst es danach ändern.")
                    }
                }
                if !aiMode {
                    Section {
                        OptionalDateField(label: "Beginn", date: $startDate)
                        OptionalDateField(label: "Ende", date: $endDate, fallback: startDate)
                    } header: {
                        Text("Zeitraum")
                    } footer: {
                        Text("Freiwillig. Ohne Angabe ergibt sich der Zeitraum aus den Einträgen.")
                    }
                }
                if original != nil {
                    Section("Notizen") {
                        TextField("Notizen", text: $notes, axis: .vertical).lineLimit(3...8)
                    }
                }
                if let progress {
                    Section { HStack { ProgressView(); Text(progress) } }
                }
            }
            .navigationTitle(original == nil ? "Neue Reise" : "Reise bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else if let created {
                        Button("Zur Reise") { onSaved(created); dismiss() }
                    } else {
                        Button(original != nil ? "Speichern" : aiMode ? "Mit KI aufbauen" : "Anlegen") { Task { await save() } }
                    }
                }
            }
            .interactiveDismissDisabled(busy)
            .onAppear {
                guard !modeChosen else { return }
                modeChosen = true
                if aiAvailable { mode = "ai"; kind = "auto" }
            }
            .onChange(of: mode) { _, m in
                if m == "ai" && original == nil { kind = "auto" } else if kind == "auto" { kind = "cruise" }
            }
        }
    }

    private func kindRow(kind k: String, label: String, icon: String, hint: String) -> some View {
        Button {
            kind = k
        } label: {
            HStack(alignment: .top) {
                Text(icon)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).foregroundStyle(.primary)
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if kind == k { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
        .disabled(busy || created != nil)
    }

    private func save() async {
        error = nil
        let t = title.trimmingCharacters(in: .whitespaces)
        if !aiMode && t.isEmpty { error = "Bitte einen Namen eingeben."; return }
        if aiMode && files.isEmpty { error = "Bitte mindestens ein Dokument, ein Foto oder Text hinzufügen, oder wechsle zu „Von Hand“."; return }
        if let s = startDate, let e = endDate, e < s { error = "Das Ende liegt vor dem Beginn."; return }
        let sendKind = kind == "auto" ? "city" : kind
        var body: [String: JSONValue] = ["title": .string(t.isEmpty ? TripTitle.placeholder : t), "kind": .string(sendKind)]
        if !aiMode {
            body["startDate"] = EditMerge.text(startDate)
            body["endDate"] = EditMerge.text(endDate)
        }
        busy = true
        defer { busy = false; progress = nil }
        do {
            if let original {
                body["notes"] = EditMerge.text(notes)
                let old: [String: JSONValue] = ["title": .string(original.title), "kind": EditMerge.text(original.kind),
                                                "startDate": EditMerge.text(original.startDate),
                                                "endDate": EditMerge.text(original.endDate), "notes": EditMerge.text(original.notes)]
                let changed = EditMerge.changed(original: old, new: body)
                if !changed.isEmpty { try await session.call { try await $0.patchTrip(tripId: original.id, changed) } }
                onSaved(TripInfo(id: original.id, title: t, kind: kind, startDate: startDate, endDate: endDate,
                                 notes: notes.isEmpty ? nil : notes))
                _ = try? await session.fetchTrips()
                dismiss()
                return
            }
            let detail = try await session.call { try await $0.createTrip(body) }
            guard let trip = detail.trip else { throw APIError.decoding("Feld trip fehlt") }
            if aiMode {
                progress = "Lädt hoch …"
                let result = await DocumentUploader.upload(session: session, tripId: trip.id, files: files, grouped: grouped)
                files = []
                if !result.errors.isEmpty {
                    _ = try? await session.fetchTrips()
                    error = result.errors.joined(separator: "\n")
                    created = trip
                    return
                }
            }
            _ = try? await session.fetchTrips()
            onSaved(trip)
            dismiss()
        } catch {
            self.error = SaveError.text(error)
        }
    }
}

// MARK: - Kreuzfahrt

struct CruiseFormView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    let cruise: CruiseSummary
    let ctx: EditContext

    @State private var shipName: String
    @State private var cruiseLine: String
    @State private var cabin: String
    @State private var bookingRef: String
    @State private var notes: String
    @State private var infos: [Info]
    @State private var money: MoneyState
    @State private var error: String?
    @State private var busy = false

    init(cruise: CruiseSummary, ctx: EditContext) {
        self.cruise = cruise
        self.ctx = ctx
        _shipName = State(initialValue: cruise.shipName ?? "")
        _cruiseLine = State(initialValue: cruise.cruiseLine ?? "")
        _cabin = State(initialValue: cruise.cabin ?? "")
        _bookingRef = State(initialValue: cruise.bookingRef ?? "")
        _notes = State(initialValue: cruise.notes ?? "")
        _infos = State(initialValue: cruise.infos ?? [])
        _money = State(initialValue: MoneyState(cost: cruise.cost, currency: cruise.currency, status: cruise.paymentStatus,
                                                paid: cruise.paidAmount, due: cruise.dueDate))
    }

    var body: some View {
        NavigationStack {
            Form {
                FormErrorSection(error: error)
                Section("Schiff") {
                    TextField("Schiff, z. B. Mein Schiff 4", text: $shipName)
                    TextField("Reederei", text: $cruiseLine)
                    TextField("Kabine, z. B. 8142, Balkon", text: $cabin)
                    TextField("Buchungsnummer", text: $bookingRef).autocorrectionDisabled()
                }
                Section {
                    MoneyFields(money: $money)
                } header: {
                    Text("Preis")
                } footer: {
                    Text("Gesamtpreis der Kreuzfahrt-Buchung")
                }
                InfoEditorSection(title: "Zusatzinfos", infos: $infos)
                Section("Notizen") {
                    TextField("Notizen", text: $notes, axis: .vertical).lineLimit(3...8)
                }
            }
            .navigationTitle("Kreuzfahrt bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Speichern") { Task { await save() } } }
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private func save() async {
        error = nil
        guard !shipName.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Bitte den Schiffsnamen angeben."; return }
        let built = money.build()
        guard let m = built.value else { error = built.error; return }
        var body: [String: JSONValue] = ["shipName": .string(shipName.trimmingCharacters(in: .whitespaces)),
                                         "cruiseLine": EditMerge.text(cruiseLine), "cabin": EditMerge.text(cabin),
                                         "bookingRef": EditMerge.text(bookingRef), "notes": EditMerge.text(notes),
                                         "infos": EditMerge.infos(infos)]
        body.merge(m.json) { _, new in new }
        var old: [String: JSONValue] = ["shipName": EditMerge.text(cruise.shipName), "cruiseLine": EditMerge.text(cruise.cruiseLine),
                                        "cabin": EditMerge.text(cruise.cabin), "bookingRef": EditMerge.text(cruise.bookingRef),
                                        "notes": EditMerge.text(cruise.notes), "infos": EditMerge.infos(cruise.infos ?? [])]
        old.merge(MoneyInput.Value(cost: cruise.cost, currency: cruise.currency, paymentStatus: cruise.paymentStatus,
                                   paidAmount: cruise.paidAmount, dueDate: cruise.dueDate).json) { _, new in new }
        let changed = EditMerge.changed(original: old, new: body)
        MoneyInput.remember(m.currency)
        busy = true
        defer { busy = false }
        do {
            if !changed.isEmpty { try await session.call { try await $0.patchCruise(cruiseId: cruise.id, changed) } }
            await ctx.reload()
            dismiss()
        } catch {
            self.error = SaveError.text(error)
        }
    }
}

// MARK: - Reisetag

struct CruiseDayFormView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    let cruise: CruiseSummary
    let original: CruiseDay?
    let ctx: EditContext
    let onDeleted: () -> Void

    @State private var date: String?
    @State private var kind: String
    @State private var portName: String
    @State private var country: String
    @State private var timezone: String
    @State private var arrival: String?
    @State private var departure: String?
    @State private var allAboard: String?
    @State private var tender: Bool
    @State private var notes: String
    @State private var infos: [Info]
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    init(cruise: CruiseSummary, day: CruiseDay? = nil, ctx: EditContext, onDeleted: @escaping () -> Void = {}) {
        self.cruise = cruise
        self.original = day
        self.ctx = ctx
        self.onDeleted = onDeleted
        let lastDay = cruise.days?.map(\.date).max()
        _date = State(initialValue: day?.date ?? lastDay.flatMap { LocalTime.addDays($0, 1) })
        _kind = State(initialValue: day?.kind ?? "port")
        _portName = State(initialValue: day?.portName ?? "")
        _country = State(initialValue: day?.country ?? "")
        _timezone = State(initialValue: day?.timezone ?? "")
        _arrival = State(initialValue: day?.arrival)
        _departure = State(initialValue: day?.departure)
        _allAboard = State(initialValue: day?.allAboard)
        _tender = State(initialValue: day?.tender ?? false)
        _notes = State(initialValue: day?.notes ?? "")
        _infos = State(initialValue: day?.infos ?? [])
    }

    private var isSea: Bool { kind == "sea" }

    /// Beschriftungen je Art (CruiseForms.tsx); bei Ausschiffung heißt die Abfahrt „Von Bord bis“.
    private var labels: (arrival: String, departure: String, allAboard: String?) {
        switch kind {
        case "embarkation": return ("Check-in ab", "Abfahrt", "Alle an Bord")
        case "disembarkation": return ("Ankunft", "Von Bord bis", nil)
        default: return ("Ankunft", "Abfahrt", "Alle an Bord")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                FormErrorSection(error: error)
                Section {
                    Picker("Art", selection: $kind) {
                        ForEach(["embarkation", "port", "sea", "disembarkation"], id: \.self) { k in
                            let info = Labels.dayKind(k)
                            Text("\(info.icon) \(info.label)").tag(k)
                        }
                    }
                    OptionalDateField(label: "Datum", date: $date)
                    TimezoneField(label: "Zeitzone", tz: $timezone, placeholder: ctx.defaultTz)
                }
                if !isSea {
                    Section {
                        TextField("Hafen, z. B. Neapel", text: $portName)
                        TextField("Land, z. B. Italien", text: $country)
                        OptionalTimeField(label: labels.arrival, time: $arrival)
                        OptionalTimeField(label: labels.departure, time: $departure)
                        if let l = labels.allAboard { OptionalTimeField(label: l, time: $allAboard) }
                        if kind != "disembarkation" { Toggle("Tenderhafen (Ausbooten)", isOn: $tender) }
                    } header: {
                        Text("Hafen (Ortszeit)")
                    } footer: {
                        if kind == "disembarkation" {
                            Text("„Von Bord bis“ ist nur das Limit oder dein Slot, wenn die Abreise über die Reederei läuft. Bei eigener Abreise rechnet die App ab 06:00 (oder 30 Min. nach Ankunft des Schiffs).")
                        } else {
                            Text("„Alle an Bord“ steht im Tagesprogramm an Bord.")
                        }
                    }
                }
                InfoEditorSection(title: "Zusatzinfos", infos: $infos)
                Section("Notizen") {
                    TextField(isSea ? "z. B. Kapitänsdinner" : "Notizen", text: $notes, axis: .vertical).lineLimit(2...6)
                }
                if original != nil && ctx.canEdit {
                    Section {
                        Button("Reisetag löschen", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(original == nil ? "Reisetag hinzufügen" : "Reisetag bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Abbrechen") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button("Speichern") { Task { await save() } } }
                }
            }
            .confirmationDialog("Diesen Reisetag löschen?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Löschen", role: .destructive) { Task { await remove() } }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private func save() async {
        error = nil
        guard let date else { error = "Bitte ein Datum angeben."; return }
        let body: [String: JSONValue] = [
            "date": .string(date), "kind": .string(kind),
            "portName": isSea ? .null : EditMerge.text(portName),
            "country": isSea ? .null : EditMerge.text(country),
            "timezone": EditMerge.text(timezone),
            "arrival": isSea ? .null : EditMerge.text(arrival),
            "departure": isSea ? .null : EditMerge.text(departure),
            "allAboard": isSea || kind == "disembarkation" ? .null : EditMerge.text(allAboard),
            "tender": .bool(!isSea && kind != "disembarkation" && tender),
            "notes": EditMerge.text(notes),
            "infos": EditMerge.infos(infos),
        ]
        busy = true
        defer { busy = false }
        do {
            if let d = original {
                let old: [String: JSONValue] = [
                    "date": .string(d.date), "kind": .string(d.kind), "portName": EditMerge.text(d.portName),
                    "country": EditMerge.text(d.country), "timezone": EditMerge.text(d.timezone),
                    "arrival": EditMerge.text(d.arrival), "departure": EditMerge.text(d.departure),
                    "allAboard": EditMerge.text(d.allAboard), "tender": .bool(d.tender ?? false),
                    "notes": EditMerge.text(d.notes), "infos": EditMerge.infos(d.infos ?? []),
                ]
                let changed = EditMerge.changed(original: old, new: body)
                if !changed.isEmpty { try await session.call { try await $0.patchCruiseDay(dayId: d.id, changed) } }
            } else {
                try await session.call { try await $0.addCruiseDay(cruiseId: cruise.id, body) }
            }
            await ctx.reload()
            dismiss()
        } catch {
            self.error = SaveError.text(error)
        }
    }

    private func remove() async {
        guard let d = original else { return }
        error = nil
        busy = true
        defer { busy = false }
        do {
            try await session.call { try await $0.deleteCruiseDay(dayId: d.id) }
            await ctx.reload()
            dismiss()
            onDeleted()
        } catch {
            self.error = SaveError.text(error)
        }
    }
}

// ENDE EditForms.swift
