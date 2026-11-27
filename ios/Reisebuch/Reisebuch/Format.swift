//
//  Format.swift
//  Reisebuch
//
//  Deutsche Formatierung und Bezeichnungen wie in der Web-App (web/src/format.ts).
//  Datumsangaben des Servers ("2027-05-08") sind Kalendertage ohne Uhrzeit; sie werden ohne Zeitzonen-
//  Umrechnung angezeigt. Uhrzeiten von Einträgen sind Ortszeit und werden so angezeigt, wie sie dastehen.
//

import Foundation

enum Fmt {
    private static let locale = Locale(identifier: "de_DE")
    private static let utc = TimeZone(identifier: "UTC")!

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = utc
        c.locale = locale
        return c
    }

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = utc
        f.calendar = calendar
        f.dateFormat = pattern
        return f
    }

    private static let isoDay = formatter("yyyy-MM-dd")
    private static let dayMonth = formatter("d. MMMM")
    private static let dayMonthYear = formatter("d. MMMM yyyy")
    private static let dayHeaderFormat = formatter("EEE, d. MMMM")
    private static let weekdayDate = formatter("EEE, d. MMMM yyyy")

    /// "2027-05-08" oder "2027-05-08T09:40" → Kalendertag.
    static func day(_ text: String?) -> Date? {
        guard let text, text.count >= 10 else { return nil }
        return isoDay.date(from: String(text.prefix(10)))
    }

    /// "8. Mai – 13. Mai 2027", über den Jahreswechsel mit beiden Jahren.
    static func range(_ start: String?, _ end: String?) -> String {
        guard let s = day(start) else { return "Noch keine Daten" }
        guard let e = day(end), e != s else { return dayMonthYear.string(from: s) }
        if calendar.component(.year, from: s) == calendar.component(.year, from: e) {
            return "\(dayMonth.string(from: s)) – \(dayMonthYear.string(from: e))"
        }
        return "\(dayMonthYear.string(from: s)) – \(dayMonthYear.string(from: e))"
    }

    /// Überschrift eines Tages: "Fr., 8. Mai".
    static func dayHeader(_ text: String) -> String {
        guard let d = day(text) else { return text }
        return dayHeaderFormat.string(from: d)
    }

    /// Heutiges Datum als "YYYY-MM-DD" in der Zeitzone des Geräts.
    static func todayISO() -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// Lokale Zeit eines Eintrags lesbar: "Fr., 8. Mai 2027, 09:40" bzw. nur der Tag.
    static func local(_ text: String?) -> String {
        guard let text, let d = day(text) else { return text ?? "" }
        let datePart = weekdayDate.string(from: d)
        if text.count >= 16 {
            let start = text.index(text.startIndex, offsetBy: 11)
            let end = text.index(start, offsetBy: 5)
            return "\(datePart), \(text[start..<end])"
        }
        return datePart
    }

    /// Kurzer Zonenname ("MESZ", "GMT-4") für eine IANA-Zone an einem Tag; sonst die Zone selbst.
    static func zoneLabel(_ tz: String?, on text: String?) -> String? {
        guard let tz, !tz.isEmpty else { return nil }
        guard let zone = TimeZone(identifier: tz) else { return tz }
        let date = day(text).map { $0.addingTimeInterval(12 * 3600) } ?? Date()
        let style: TimeZone.NameStyle = zone.isDaylightSavingTime(for: date) ? .shortDaylightSaving : .shortStandard
        let short = zone.localizedName(for: style, locale: locale) ?? tz
        return "\(short), \(tz)"
    }

    /// Betrag mit Währung; ohne Währung nur die Zahl (keine Annahme wie CHF).
    static func money(_ amount: Double, _ currency: String?) -> String {
        if let currency, currency.count == 3 {
            return amount.formatted(.currency(code: currency).locale(locale))
        }
        let number = amount.formatted(.number.precision(.fractionLength(2)).locale(locale))
        if let currency, !currency.isEmpty { return "\(number) \(currency)" }
        return "\(number) (ohne Währung)"
    }

    /// "tel:" ohne Leerzeichen und Trennzeichen; ein führendes + bleibt.
    static func telURL(_ number: String) -> URL? {
        var digits = ""
        for (i, ch) in number.enumerated() {
            if ch.isNumber { digits.append(ch) }
            else if ch == "+" && digits.isEmpty && i < 3 { digits.append(ch) }
        }
        guard !digits.isEmpty else { return nil }
        return URL(string: "tel:\(digits)")
    }

    static func appVersion() -> String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (Build \(build))"
    }
}

// MARK: - Bezeichnungen

enum Labels {
    static func tripKind(_ kind: String?) -> (icon: String, label: String) {
        switch kind {
        case "city": return ("🏙️", "Städtetrip / Urlaub")
        case "roundtrip": return ("🗺️", "Rundreise")
        default: return ("🛳️", "Kreuzfahrt")
        }
    }

    static func itemType(_ type: String) -> (icon: String, label: String) {
        switch type {
        case "flight": return ("✈️", "Flug")
        case "train": return ("🚆", "Zug")
        case "transfer": return ("🚐", "Transfer")
        case "stop": return ("📍", "Station")
        case "hotel": return ("🏨", "Übernachtung")
        case "parking": return ("🅿️", "Parkplatz")
        case "car_rental": return ("🚗", "Mietwagen")
        case "bus": return ("🚌", "Bus")
        case "ferry": return ("⛴️", "Fähre")
        case "excursion": return ("🧭", "Landausflug")
        case "activity": return ("🎟️", "Aktivität")
        case "restaurant": return ("🍽️", "Restaurant")
        case "note": return ("📝", "Notiz")
        default: return ("•", type)
        }
    }

    static func startLabel(_ type: String) -> String? {
        switch type {
        case "flight": return "Abflug"
        case "train", "bus", "ferry": return "Abfahrt"
        case "transfer", "car_rental": return "Abholung"
        case "parking": return "Einfahrt"
        case "hotel": return "Check-in"
        case "stop": return "Ankunft"
        default: return nil
        }
    }

    static func endLabel(_ type: String) -> String? {
        switch type {
        case "flight", "train", "bus", "ferry", "transfer": return "Ankunft"
        case "car_rental": return "Rückgabe"
        case "parking": return "Ausfahrt"
        case "hotel": return "Check-out"
        case "stop": return "Abreise"
        default: return nil
        }
    }

    static func dayKind(_ kind: String) -> (icon: String, label: String) {
        switch kind {
        case "embarkation": return ("🛳️", "Einschiffung")
        case "port": return ("⚓", "Hafentag")
        case "sea": return ("🌊", "Seetag")
        case "disembarkation": return ("🧳", "Ausschiffung")
        default: return ("•", kind)
        }
    }

    static func payment(_ status: String?) -> String {
        switch status {
        case "open": return "offen"
        case "deposit": return "angezahlt"
        case "paid": return "bezahlt"
        default: return "keine Angabe"
        }
    }

    /// Wo ihr sein müsst (wie placeLine in format.ts): Terminal, Schalter, Gate, Kofferband, Gleis.
    static func placeLine(_ item: Item) -> String {
        let fields: [(String, String)]
        switch item.type {
        case "flight": fields = [("terminal", "Terminal"), ("checkinDesk", "Schalter"), ("gate", "Gate"), ("baggageBelt", "Kofferband")]
        case "train": fields = [("platform", "Gleis")]
        case "car_rental": fields = [("desk", "Schalter")]
        default: fields = []
        }
        let d = item.detailMap
        return fields.compactMap { key, label in
            guard let v = d[key]?.trimmingCharacters(in: .whitespaces), !v.isEmpty else { return nil }
            return "\(label) \(v)"
        }.joined(separator: " · ")
    }

    /// Kurze Zusammenfassung wie itemSubtitle in format.ts.
    static func subtitle(_ item: Item) -> String {
        let d = item.detailMap
        var parts: [String] = []
        if d["from"] != nil || d["to"] != nil { parts.append("\(d["from"] ?? "?") → \(d["to"] ?? "?")") }
        if let v = d["flightNumber"], !v.isEmpty { parts.append(v) }
        if let v = d["trainNumber"], !v.isEmpty { parts.append(v) }
        if item.type == "excursion" { parts.append(d["bookedVia"] == "private" ? "privat gebucht" : "über Reederei") }
        if let v = d["mode"], !v.isEmpty { parts.append(v) }
        if let v = d["plate"], !v.isEmpty { parts.append(v) }
        if let v = d["meetingPoint"], !v.isEmpty { parts.append("Treffpunkt: \(v)") }
        if let loc = item.location, !loc.isEmpty, d["from"] == nil, d["to"] == nil { parts.append(loc) }
        if let p = item.provider, !p.isEmpty { parts.append(p) }
        return parts.joined(separator: " · ")
    }

    /// Lesbare Namen bekannter details-Schlüssel; Unbekanntes bleibt beim Schlüssel.
    static func detailKey(_ key: String) -> String {
        // Schlüssel wie im Eintragsformular der Web-App (web/src/components/ItemForm.tsx, DETAIL_FIELDS).
        let known: [String: String] = [
            "airline": "Airline", "flightNumber": "Flugnummer", "from": "Von", "to": "Nach", "terminal": "Terminal",
            "checkinDesk": "Check-in-Schalter", "gate": "Gate", "baggageBelt": "Kofferband (Ankunft)", "seat": "Sitzplatz",
            "trainNumber": "Zugnummer", "platform": "Gleis", "cabin": "Kabine/Deck", "mode": "Art", "phone": "Telefon",
            "carClass": "Fahrzeug", "desk": "Schalter (Abholung)", "returnLocation": "Rückgabeort", "country": "Land",
            "room": "Zimmer", "breakfast": "Verpflegung", "address": "Adresse", "lot": "Parkplatz / Parkhaus",
            "plate": "Kennzeichen", "shuttle": "Shuttle zum Terminal", "meetingPoint": "Treffpunkt", "guests": "Personen",
            "bookedVia": "Gebucht über",
        ]
        return known[key] ?? key
    }

    static func detailValue(key: String, value: String) -> String {
        if key == "bookedVia" {
            switch value {
            case "private": return "privat"
            case "ship": return "Reederei"
            default: return value
            }
        }
        return value
    }

    /// details-Schlüssel, deren Wert eine Telefonnummer ist (Hotel, Fahrer).
    static func isPhoneDetail(_ key: String) -> Bool { key == "phone" }
}

// ENDE Format.swift
