//
//  ReisebuchWidget.swift
//  ReisebuchWidget
//
//  Widget „Nächster Termin“: Sperrbildschirm (rechteckig, eine Zeile) und Home-Bildschirm (klein, mittel).
//  Liest nur den Stand, den die App in die App Group legt (WidgetStand.swift), keine Netzanfragen.
//  Zeigt auch bei gesperrtem iPhone; deshalb nur Zeit, Titel, Ort und Reise, keine Buchungsnummern, Preise, Telefonnummern.
//

import WidgetKit
import SwiftUI

struct TerminEntry: TimelineEntry {
    let date: Date
    /// nil = keine Daten (nie angemeldet oder abgemeldet).
    let stand: WidgetStand?
}

struct TerminProvider: TimelineProvider {
    func placeholder(in context: Context) -> TerminEntry {
        // Der echte Stand (schnell, nur UserDefaults); das Beispiel steht nur in den Xcode-Vorschauen.
        TerminEntry(date: Date(), stand: WidgetStandStore.load())
    }

    func getSnapshot(in context: Context, completion: @escaping (TerminEntry) -> Void) {
        // Auch in der Galerie der echte Stand, damit „Nicht angemeldet“ dort sichtbar ist.
        completion(TerminEntry(date: Date(), stand: WidgetStandStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TerminEntry>) -> Void) {
        let now = Date()
        let stand = WidgetStandStore.load()
        let dates = WidgetAuswahl.eintragsZeiten(stand?.termine ?? [], now: now)
        let entries = dates.map { TerminEntry(date: $0, stand: stand) }
        // Mit Terminen weiterspringen bis zum letzten; ohne Termine meldet sich die App, wenn sich etwas ändert.
        let policy: TimelineReloadPolicy = entries.count > 1 ? .atEnd : .after(now.addingTimeInterval(3600))
        completion(Timeline(entries: entries, policy: policy))
    }
}

struct ReisebuchWidget: Widget {
    let kind = "ReisebuchWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TerminProvider()) { entry in
            TerminWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Nächster Termin")
        .description("Der aktuelle oder nächste Termin deiner Reisen mit Gate, Schalter oder Gleis.")
        .supportedFamilies([.accessoryRectangular, .accessoryInline, .systemSmall, .systemMedium])
    }
}

// MARK: - Ansicht

struct TerminWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TerminEntry

    private var auswahl: (termin: WidgetTermin?, folgender: WidgetTermin?) {
        WidgetAuswahl.aktuell(entry.stand?.termine ?? [], now: entry.date)
    }

    private var linkURL: URL? {
        guard let id = auswahl.termin?.reiseId,
              let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else {
            return URL(string: "reisebuch://")
        }
        return URL(string: "reisebuch://trip/\(encoded)")
    }

    var body: some View {
        content.widgetURL(linkURL)
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryRectangular: rectangular
        case .systemMedium: medium
        default: small
        }
    }

    /// Text ohne Termin: nicht angemeldet oder nichts in 7 Tagen.
    private var leerText: String {
        entry.stand == nil ? "Nicht angemeldet" : "Keine Termine in den nächsten 7 Tagen"
    }

    // Sperrbildschirm, eine Zeile.
    @ViewBuilder private var inline: some View {
        if let t = auswahl.termin {
            Text(WidgetAuswahl.inlineText(t, now: entry.date))
        } else {
            Text(entry.stand == nil ? "Reisebuch · Nicht angemeldet" : "Keine Termine in 7 Tagen")
        }
    }

    // Sperrbildschirm, rechteckig. Keine Farben, iOS färbt selbst.
    @ViewBuilder private var rectangular: some View {
        if let t = auswahl.termin {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(t.symbol) \(WidgetAuswahl.zeitText(t, now: entry.date))")
                    .font(.headline)
                    .widgetAccentable()
                Text(t.titel).lineLimit(1)
                if let ort = t.ort {
                    Text(ort).bold().lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text("Reisebuch").font(.headline).widgetAccentable()
                Text(leerText).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // Home-Bildschirm, klein.
    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            kopf(auswahl.termin)
            if let t = auswahl.termin {
                TerminBlock(termin: t, now: entry.date, titelZeilen: 3)
            } else {
                leer
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    // Home-Bildschirm, mittel: dazu der folgende Termin und der Reisetitel.
    private var medium: some View {
        VStack(alignment: .leading, spacing: 4) {
            kopf(auswahl.termin)
            if let t = auswahl.termin {
                TerminBlock(termin: t, now: entry.date, titelZeilen: 2)
                Spacer(minLength: 0)
                if let f = auswahl.folgender {
                    Text("Danach \(WidgetAuswahl.zeitText(f, now: entry.date)) \(f.symbol) \(f.titel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } else {
                leer
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// Kopfzeile: Kompass klein und, falls Platz, der Reisetitel.
    private func kopf(_ t: WidgetTermin?) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "safari")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(t?.reise ?? "Reisebuch")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private var leer: some View {
        Text(leerText)
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }
}

/// Zeit, Titel und fett der Ort eines Termins.
private struct TerminBlock: View {
    let termin: WidgetTermin
    let now: Date
    let titelZeilen: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(WidgetAuswahl.zeitText(termin, now: now))
                .font(.headline.monospacedDigit())
            Text("\(termin.symbol) \(termin.titel)")
                .font(.subheadline)
                .lineLimit(titelZeilen)
            if let ort = termin.ort {
                Text(ort)
                    .font(.subheadline.bold())
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
        }
    }
}

// MARK: - Beispiel für die Xcode-Vorschau (erfundene Daten)

enum WidgetBeispiel {
    static func stand(now: Date) -> WidgetStand {
        let ms = WidgetTermin.ms(now)
        let h: Int64 = 3_600_000
        return WidgetStand(updated: ms, termine: [
            WidgetTermin(start: ms + h, ende: ms + 3 * h, tz: TimeZone.current.identifier, symbol: "✈️",
                         titel: "Flug nach Lissabon", ort: "Terminal 1 · Gate B12", reise: "Beispielreise", reiseId: "beispiel"),
            WidgetTermin(start: ms + 6 * h, ende: ms + 6 * h, tz: TimeZone.current.identifier, symbol: "🏨",
                         titel: "Hotel am Hafen", ort: nil, reise: "Beispielreise", reiseId: "beispiel"),
        ])
    }
}

#Preview("Klein", as: .systemSmall) {
    ReisebuchWidget()
} timeline: {
    TerminEntry(date: .now, stand: WidgetBeispiel.stand(now: .now))
    TerminEntry(date: .now, stand: WidgetStand(updated: 0, termine: []))
    TerminEntry(date: .now, stand: nil)
}

#Preview("Mittel", as: .systemMedium) {
    ReisebuchWidget()
} timeline: {
    TerminEntry(date: .now, stand: WidgetBeispiel.stand(now: .now))
}

#Preview("Sperrbildschirm", as: .accessoryRectangular) {
    ReisebuchWidget()
} timeline: {
    TerminEntry(date: .now, stand: WidgetBeispiel.stand(now: .now))
}

#Preview("Eine Zeile", as: .accessoryInline) {
    ReisebuchWidget()
} timeline: {
    TerminEntry(date: .now, stand: WidgetBeispiel.stand(now: .now))
}

// ENDE ReisebuchWidget.swift
