//
//  AISettingsView.swift
//  Reisebuch
//
//  Einstellungen „KI und Dokumente“ (Auftrag 0.8.0, wie settings/Ai.tsx): Stand aus /ai/status für alle; für Admins Hauptanbieter,
//  Ausweich, Schlüssel und Modell je Anbieter (Claude, ChatGPT, Gemini) und Verbindungstest. Ein API-Schlüssel steht nur im Feld,
//  bis er gesendet ist: nie in UserDefaults, Schlüsselbund, Cache oder Log.
//

import SwiftUI

struct AISettingsView: View {
    @Environment(AppSession.self) private var session

    @State private var config: AIConfig?
    @State private var errorText: String?
    /// Nur im Speicher dieser Ansicht; nach Erfolg geleert.
    @State private var keys: [String: String] = [:]
    @State private var models: [String: String] = [:]
    @State private var busy: String?
    @State private var notice: (ok: Bool, text: String)?
    @State private var check: AICheck?
    @State private var removing: AIProviderState?

    var body: some View {
        Form {
            statusSection
            if session.isAdmin {
                if let errorText {
                    Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                }
                if let config { adminSections(config) } else if errorText == nil { Section { ProgressView() } }
            }
        }
        .navigationTitle("KI und Dokumente")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await session.refreshAIStatus()
            if session.isAdmin { await load() }
        }
        .confirmationDialog("Schlüssel von \(removing?.label ?? "") aus den Einstellungen entfernen?",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
                            titleVisibility: .visible) {
            Button("Entfernen", role: .destructive) {
                if let p = removing { Task { await put(AIConfigBody.key(p.id, nil), "key-\(p.id)", "\(p.label): Schlüssel entfernt.") } }
            }
        }
    }

    // MARK: Für alle

    private var statusSection: some View {
        Section {
            let s = session.aiStatus
            LabeledContent("KI", value: s?.enabled == true ? "an" : "aus")
            if let p = s?.providers, !p.isEmpty { LabeledContent("Anbieter", value: p.joined(separator: " → ")) }
            if let m = s?.model, !m.isEmpty { LabeledContent("Zuletzt", value: m) }
            LabeledContent("Dokumente lesen", value: s?.enabled == true ? "ja" : "nein")
            LabeledContent("Recherche im Internet", value: s?.research == true ? "ja" : "nein")
            LabeledContent("Reise prüfen", value: s?.review == true ? "ja" : "nein")
            LabeledContent("Reisetag-Abfrage", value: s?.placeLookup == true ? "ja" : "nein")
        } header: {
            Text("Stand")
        } footer: {
            Text("Hochgeladene Dokumente und die Daten für Recherche und Prüfen gehen an den eingestellten KI-Anbieter.")
        }
    }

    // MARK: Admin

    @ViewBuilder
    private func adminSections(_ cfg: AIConfig) -> some View {
        let configurable = cfg.configurable != false
        Section {
            if let active = cfg.active, !active.isEmpty {
                Text("Aktiv: " + active.map { "\($0.label)\($0.model.map { " (\($0))" } ?? "")" }.joined(separator: " → ")
                     + (active.count > 1 ? ". Fällt der erste aus (Fehler, Limit, kein Guthaben), springt der nächste ein." : "."))
                    .font(.subheadline)
            } else {
                Text("Keine KI eingerichtet. Trage unten mindestens einen Schlüssel ein.").foregroundStyle(.secondary)
            }
            if !configurable { Text("In dieser Umgebung ist die KI fest eingestellt.").foregroundStyle(.secondary) }
            Picker("Hauptanbieter", selection: Binding(get: { cfg.primary ?? "" }, set: { id in
                Task { await put(AIConfigBody.primary(id), "primary", "Hauptanbieter geändert.") }
            })) {
                ForEach(cfg.providers) { p in Text(p.label + (p.configured ? "" : " (kein Schlüssel)")).tag(p.id) }
            }
            .disabled(!configurable || busy != nil)
            Toggle("Ausweich: bei einem Fehler die anderen Anbieter mit Schlüssel versuchen", isOn: Binding(get: { cfg.fallback == true }, set: { on in
                Task { await put(AIConfigBody.fallback(on), "fallback", on ? "Ausweich ist an." : "Ausweich ist aus.") }
            }))
            .disabled(!configurable || busy != nil)
            Button(busy == "check" ? "Prüft …" : "Verbindung testen") { Task { await test() } }
                .disabled(busy != nil || !cfg.providers.contains { $0.configured })
            if let check {
                ForEach(check.results ?? []) { r in
                    Text("\(r.ok ? "✓" : "✗") \(r.label)\(r.model.map { " (\($0))" } ?? "")\(r.ok ? ": Verbindung steht." : ": \(r.error ?? "")")")
                        .foregroundStyle(r.ok ? Color.primary : Color.red)
                }
                if (check.results ?? []).isEmpty { Text("✓ Verbindung steht (\(check.model ?? "")).") }
            }
            if let notice { Text(notice.text).foregroundStyle(notice.ok ? Color.green : Color.red) }
        } header: {
            Text("KI für Dokumente, Recherche und Prüfen")
        }
        ForEach(cfg.providers) { p in
            Section(p.label) {
                if p.configured {
                    Text("Schlüssel eingerichtet (endet auf \(String((p.keyHint ?? "").drop { $0 == "…" }))\(p.source == "env" ? ", aus der .env auf dem Server" : "")).")
                        .font(.subheadline)
                } else {
                    let w = AIConfigBody.whereToGet[p.id]
                    Text("Kein Schlüssel. Einen API-Schlüssel bekommst du auf \(w?.site ?? "der Seite des Anbieters") unter „\(w?.hint ?? "API keys")“.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                if configurable {
                    SecureField(p.configured ? "Neuer Schlüssel" : "API-Schlüssel", text: Binding(get: { keys[p.id] ?? "" }, set: { keys[p.id] = $0 }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.none)
                    Button(busy == "key-\(p.id)" ? "Prüft …" : "Prüfen und speichern") { Task { await saveKey(p) } }
                        .disabled(busy != nil || (keys[p.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                    if p.source == "settings" {
                        Button("Schlüssel entfernen", role: .destructive) { removing = p }.disabled(busy != nil)
                    }
                    TextField("Modell (leer = \(p.defaultModel ?? "Standard"))",
                              text: Binding(get: { models[p.id] ?? (p.model == p.defaultModel ? "" : (p.model ?? "")) },
                                            set: { models[p.id] = $0 }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Modell speichern") {
                        let m = models[p.id] ?? ""
                        Task { await put(AIConfigBody.model(p.id, m), "model-\(p.id)", "\(p.label): Modell \(m.isEmpty ? (p.defaultModel ?? "Standard") : m) eingestellt.") }
                    }
                    .disabled(busy != nil || models[p.id] == nil)
                }
            }
        }
        Section {
            Text("Schlüssel werden auf dem Server in der Datenbank gespeichert (auch in den täglichen Backups) und nie wieder angezeigt. Gib sie nur über die verschlüsselte Verbindung ein (VPN oder https://…:8444).")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func load() async {
        do {
            config = try await session.call { try await $0.aiConfig() }
            errorText = nil
        } catch {
            errorText = SaveError.text(error)
        }
    }

    @discardableResult
    private func put(_ body: [String: JSONValue], _ what: String, _ done: String) async -> Bool {
        busy = what
        notice = nil
        check = nil
        defer { busy = nil }
        do {
            config = try await session.call { try await $0.putAIConfig(body) }
            notice = (true, done)
            await session.refreshAIStatus()
            return true
        } catch {
            notice = (false, SaveError.text(error))
            return false
        }
    }

    private func saveKey(_ p: AIProviderState) async {
        let key = (keys[p.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        // Bei Fehler bleibt das Feld gefüllt; nach Erfolg geleert.
        if await put(AIConfigBody.key(p.id, key), "key-\(p.id)", "\(p.label): Schlüssel geprüft und gespeichert.") {
            keys[p.id] = ""
        }
    }

    private func test() async {
        busy = "check"
        notice = nil
        check = nil
        defer { busy = nil }
        do {
            check = try await session.call { try await $0.aiCheck() }
        } catch {
            notice = (false, SaveError.text(error))
        }
    }
}

// ENDE AISettingsView.swift
