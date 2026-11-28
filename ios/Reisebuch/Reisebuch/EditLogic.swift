//
//  EditLogic.swift
//  Reisebuch
//
//  Bearbeiten (Auftrag 0.6.0), reine Funktionen: Felder je Eintragsart wie web/src/components/ItemForm.tsx, Zusammenführen der
//  `details` ohne Verlust, Teil-Updates mit nur geänderten Feldern, Zeit als Ortszeit-Text, Preis und Zahlung wie MoneyFields.tsx,
//  Ansichtsmodus wie web/src/pages/Trip.tsx. Getestet in EditLogicTests.
//

import Foundation

// MARK: - Arten und Felder

enum ItemKinds {
    struct DetailField: Hashable {
        let key: String
        let label: String
        var placeholder: String = ""
    }

    /// Reihenfolge der Auswahl wie ITEM_TYPES in format.ts.
    static let all = ["flight", "train", "transfer", "stop", "hotel", "parking", "car_rental", "bus", "ferry", "excursion",
                      "activity", "restaurant", "note"]

    /// Landausflug nur bei Kreuzfahrt, Station nur sonst (wie ItemForm.tsx; mit Kreuzfahrt-Daten gilt die Reise als Kreuzfahrt).
    static func available(tripKind: String?, hasCruises: Bool) -> [String] {
        let cruiseTrip = tripKind == nil || tripKind == "cruise" || hasCruises
        return all.filter { ($0 != "excursion" || cruiseTrip) && ($0 != "stop" || !cruiseTrip) }
    }

    static let detailFields: [String: [DetailField]] = [
        "flight": [
            DetailField(key: "airline", label: "Airline", placeholder: "SWISS"),
            DetailField(key: "flightNumber", label: "Flugnummer", placeholder: "LX 1726"),
            DetailField(key: "from", label: "Von", placeholder: "ZRH"),
            DetailField(key: "to", label: "Nach", placeholder: "FCO"),
            DetailField(key: "terminal", label: "Terminal"),
            DetailField(key: "checkinDesk", label: "Check-in-Schalter", placeholder: "31–40"),
            DetailField(key: "gate", label: "Gate", placeholder: "B12"),
            DetailField(key: "baggageBelt", label: "Kofferband (Ankunft)"),
            DetailField(key: "seat", label: "Sitzplatz"),
        ],
        "train": [
            DetailField(key: "trainNumber", label: "Zugnummer", placeholder: "EC 15"),
            DetailField(key: "from", label: "Von"),
            DetailField(key: "to", label: "Nach"),
            DetailField(key: "platform", label: "Gleis"),
            DetailField(key: "seat", label: "Wagen / Platz"),
        ],
        "bus": [DetailField(key: "from", label: "Von"), DetailField(key: "to", label: "Nach")],
        "ferry": [DetailField(key: "from", label: "Von"), DetailField(key: "to", label: "Nach"),
                  DetailField(key: "cabin", label: "Kabine/Deck")],
        "transfer": [DetailField(key: "mode", label: "Art", placeholder: "Taxi, Shuttle, Bahn…"),
                     DetailField(key: "from", label: "Von", placeholder: "Flughafen FCO"),
                     DetailField(key: "to", label: "Nach", placeholder: "Hafen Civitavecchia"),
                     DetailField(key: "phone", label: "Telefon Fahrer")],
        "car_rental": [DetailField(key: "carClass", label: "Fahrzeug"), DetailField(key: "desk", label: "Schalter (Abholung)"),
                       DetailField(key: "returnLocation", label: "Rückgabeort")],
        "stop": [DetailField(key: "country", label: "Land")],
        "hotel": [DetailField(key: "room", label: "Zimmer"), DetailField(key: "phone", label: "Telefon"),
                  DetailField(key: "breakfast", label: "Verpflegung", placeholder: "Frühstück inkl.")],
        "parking": [DetailField(key: "lot", label: "Parkplatz / Parkhaus", placeholder: "P3"),
                    DetailField(key: "plate", label: "Kennzeichen"),
                    DetailField(key: "shuttle", label: "Shuttle zum Terminal", placeholder: "alle 15 min")],
        "excursion": [DetailField(key: "meetingPoint", label: "Treffpunkt", placeholder: "Theater, Deck 5")],
        "restaurant": [DetailField(key: "guests", label: "Personen")],
    ]

    /// Schlüssel, die das Formular einer Art kennt (Landausflug zusätzlich „Gebucht über“).
    static func formKeys(_ type: String) -> [String] {
        (detailFields[type] ?? []).map(\.key) + (type == "excursion" ? ["bookedVia"] : [])
    }

    static let linkable: Set<String> = ["excursion", "activity", "restaurant", "note", "transfer"]
    static let hasEnd: Set<String> = ["flight", "train", "bus", "ferry", "transfer", "car_rental", "parking", "hotel", "stop",
                                      "excursion", "activity", "restaurant"]
    static let transport: Set<String> = ["flight", "train", "bus", "ferry", "transfer"]

    static func titlePlaceholder(_ type: String) -> String {
        switch type {
        case "flight": return "Zürich → Rom"
        case "hotel": return "Hotel Artemide"
        case "parking": return "Parkhaus Flughafen"
        case "transfer": return "Taxi zum Hafen"
        case "stop": return "Florenz"
        default: return ""
        }
    }

    static let tripKinds: [(kind: String, label: String, icon: String, hint: String)] = [
        ("cruise", "Kreuzfahrt", "🛳️", "Mit Anreise, Hafentagen und Abreise"),
        ("city", "Städtetrip / Urlaub", "🏙️", "Flug, Hotel, Mietwagen und Aktivitäten an einem Ort"),
        ("roundtrip", "Rundreise", "🗺️", "Mehrere Stationen nacheinander"),
    ]

    static let paymentStatuses: [(status: String, label: String)] = [("open", "offen"), ("deposit", "angezahlt"), ("paid", "bezahlt")]

    static let infoKinds: [(kind: String, label: String)] = [("phone", "Telefon"), ("emergency", "Notruf"), ("email", "E-Mail"),
                                                              ("link", "Link"), ("text", "Hinweis")]
}

// MARK: - Zeiten

enum LocalTime {
    private static var utcCalendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }

    /// Datum und optionale Uhrzeit → „2027-05-08T09:40“ bzw. „2027-05-08“; ohne Datum nil.
    static func join(date: String?, time: String?) -> String? {
        guard let date, !date.isEmpty else { return nil }
        guard let time, !time.isEmpty else { return date }
        return "\(date)T\(time)"
    }

    /// „2027-05-08T09:40“ → („2027-05-08“, „09:40“); nur Datum → (Datum, nil).
    static func split(_ local: String?) -> (date: String?, time: String?) {
        guard let local, !local.isEmpty else { return (nil, nil) }
        let date = String(local.prefix(10))
        let time = local.count > 10 ? String(local.dropFirst(11).prefix(5)) : nil
        return (date, time?.isEmpty == true ? nil : time)
    }

    /// Für DatePicker: Datum als Kalendertag (ohne Zeitzonen-Verschiebung, UTC).
    static func date(from text: String?) -> Date? {
        guard let text, text.count >= 10 else { return nil }
        let p = text.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return utcCalendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
    }

    static func text(fromDate date: Date) -> String {
        let c = utcCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Uhrzeit „09:40“ ↔ Date (UTC-Kalender, nur Stunde und Minute zählen).
    static func time(from text: String?) -> Date? {
        guard let text else { return nil }
        let p = text.split(separator: ":").compactMap { Int($0.prefix(2)) }
        guard p.count >= 2 else { return nil }
        return utcCalendar.date(from: DateComponents(year: 2000, month: 1, day: 1, hour: p[0], minute: p[1]))
    }

    static func text(fromTime date: Date) -> String {
        let c = utcCalendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Datum plus Tage, „2027-05-08“ + 1 → „2027-05-09“.
    static func addDays(_ date: String, _ days: Int) -> String? {
        guard let d = self.date(from: date), let n = utcCalendar.date(byAdding: .day, value: days, to: d) else { return nil }
        return text(fromDate: n)
    }
}

// MARK: - details und Teil-Updates

enum EditMerge {
    /// Bisherige `details` plus die Formularwerte der bekannten Schlüssel: leeres Feld entfernt den Schlüssel, unveränderter Text
    /// behält den alten Wert (auch Zahlen), unbekannte Schlüssel bleiben erhalten.
    static func details(original: [String: JSONValue], form: [String: String], knownKeys: [String]) -> [String: JSONValue] {
        var result = original
        for key in knownKeys {
            let value = (form[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty {
                result.removeValue(forKey: key)
            } else if original[key]?.text != value {
                result[key] = .string(value)
            }
        }
        return result
    }

    /// Nur die Felder, die sich gegenüber dem Original geändert haben.
    static func changed(original: [String: JSONValue], new: [String: JSONValue]) -> [String: JSONValue] {
        new.filter { key, value in (original[key] ?? .null) != value }
    }

    static func text(_ s: String?) -> JSONValue {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return .null }
        return .string(t)
    }

    static func number(_ d: Double?) -> JSONValue { d.map { .number($0) } ?? .null }

    static func infos(_ infos: [Info]) -> JSONValue {
        .array(infos.filter { !$0.label.trimmingCharacters(in: .whitespaces).isEmpty && !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { i in
                var o: [String: JSONValue] = ["label": .string(i.label.trimmingCharacters(in: .whitespaces)),
                                              "value": .string(i.value.trimmingCharacters(in: .whitespaces)),
                                              "kind": .string(i.kind)]
                if let s = i.source { o["source"] = .string(s) }
                return .object(o)
            })
    }

    /// Ein Eintrag so, wie das Formular ihn schicken würde (zum Vergleich beim Teil-Update).
    static func payload(of item: Item) -> [String: JSONValue] {
        [
            "type": .string(item.type), "title": .string(item.title),
            "startLocal": .string(item.startLocal), "startTz": text(item.startTz),
            "endLocal": text(item.endLocal), "endTz": text(item.endTz),
            "location": text(item.location), "provider": text(item.provider), "confirmation": text(item.confirmation),
            "cost": number(item.cost), "currency": text(item.currency), "paymentStatus": text(item.paymentStatus),
            "paidAmount": number(item.paidAmount), "dueDate": text(item.dueDate),
            "notes": text(item.notes), "cruiseDayId": text(item.cruiseDayId),
            "details": .object(item.details?.raw ?? [:]), "infos": infos(item.infos ?? []),
        ]
    }
}

// MARK: - Preis und Zahlung

enum MoneyInput {
    struct Value: Equatable {
        var cost: Double?
        var currency: String?
        var paymentStatus: String?
        var paidAmount: Double?
        var dueDate: String?

        var json: [String: JSONValue] {
            ["cost": EditMerge.number(cost), "currency": EditMerge.text(currency), "paymentStatus": EditMerge.text(paymentStatus),
             "paidAmount": EditMerge.number(paidAmount), "dueDate": EditMerge.text(dueDate)]
        }
    }

    static let none = Value()

    /// „1'250,50“ → 1250.5; leer → nil; keine Zahl → Fehler.
    static func number(_ s: String) -> Result<Double?, Never>? {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "'", with: "")
            .replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        if t.isEmpty { return .success(nil) }
        guard let d = Double(t), d.isFinite else { return nil }
        return .success(d)
    }

    /// Wie MoneyFields.tsx: Anzahlung nur bei „angezahlt“, Fälligkeit nicht bei „bezahlt“, ohne Preis alles leer.
    static func build(cost: String, currency: String, status: String, paid: String, due: String?) -> (value: Value?, error: String?) {
        guard case let .success(c)? = number(cost) else { return (nil, "Kosten: bitte eine Zahl eingeben, z. B. 1250,50.") }
        var p: Double?
        if status == "deposit" {
            guard case let .success(v)? = number(paid) else { return (nil, "Anzahlung: bitte eine Zahl eingeben.") }
            p = v
        }
        let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
        if c != nil, !cur.isEmpty, !(cur.count == 3 && cur.allSatisfy({ $0.isLetter && $0.isASCII })) {
            return (nil, "Währung als 3-stelliger Code, z. B. EUR oder CHF.")
        }
        guard let c else { return (none, nil) }
        return (Value(cost: c, currency: cur.isEmpty ? nil : cur, paymentStatus: status.isEmpty ? nil : status,
                      paidAmount: status == "deposit" ? p : nil,
                      dueDate: status != "paid" && !(due ?? "").isEmpty ? due : nil), nil)
    }

    private static let currencyKey = "lastCurrency"
    /// Zuletzt benutzte Währung auf diesem Gerät (neue Einträge starten damit), sonst leer.
    static var lastCurrency: String { UserDefaults.standard.string(forKey: currencyKey) ?? "" }
    static func remember(_ currency: String?) {
        if let c = currency, c.count == 3 { UserDefaults.standard.set(c, forKey: currencyKey) }
    }

    /// Zahl als Text fürs Formular: 189.0 → „189“, 12.5 → „12.5“.
    static func text(_ d: Double?) -> String {
        guard let d else { return "" }
        return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
    }
}

// MARK: - Ansichtsmodus

enum ViewMode {
    /// Beginn des ersten Punkts der Reise (firstStart in Trip.tsx): Hafentag mit Ankunft (sonst 00:00), Einträge ab Beginn.
    static func firstStart(_ timeline: Timeline) -> Date? {
        let defaultTz = timeline.defaultTimezone ?? "Europe/Zurich"
        var first: Date?
        func take(_ d: Date?) { if let d, d != .distantFuture, first.map({ d < $0 }) ?? true { first = d } }
        for phase in timeline.phases {
            for day in phase.days {
                if let cd = day.cruiseDay {
                    take(NowLogic.instant("\(day.date)T\(cd.arrival ?? "00:00")", tz: cd.timezone ?? defaultTz))
                }
                for e in day.entries { take(NowLogic.entryStart(e, defaultTz: defaultTz)) }
            }
        }
        return first
    }

    static func started(_ timeline: Timeline, now: Date) -> Bool {
        firstStart(timeline).map { $0 <= now } ?? false
    }

    /// Gesperrt: Bearbeiter, Reise hat begonnen, nicht entsperrt.
    static func locked(isEditor: Bool, started: Bool, unlocked: Bool) -> Bool {
        isEditor && started && !unlocked
    }

    static func isEditor(_ role: String?) -> Bool { role == "owner" || role == "editor" }
}

// ENDE EditLogic.swift
