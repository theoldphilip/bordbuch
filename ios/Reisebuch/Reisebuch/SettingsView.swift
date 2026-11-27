//
//  SettingsView.swift
//  Reisebuch
//
//  Kleine Einstellungsseite: angemeldet als, Server, Versionen, Abmelden.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    @State private var serverVersion: String?
    @State private var versionError: String?
    @State private var loggingOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Anmeldung") {
                    LabeledContent("Angemeldet als", value: session.displayName.isEmpty ? "–" : session.displayName)
                    LabeledContent("Server", value: session.serverAddress)
                }
                Section("Versionen") {
                    LabeledContent("App", value: Fmt.appVersion())
                    if let serverVersion {
                        LabeledContent("Server", value: serverVersion)
                    } else if let versionError {
                        LabeledContent("Server", value: versionError)
                    } else {
                        LabeledContent("Server") { ProgressView() }
                    }
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            loggingOut = true
                            await session.logout()
                            loggingOut = false
                            dismiss()
                        }
                    } label: {
                        if loggingOut { ProgressView() } else { Text("Abmelden") }
                    }
                    .disabled(loggingOut)
                }
            }
            .navigationTitle("Einstellungen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
            .task { await loadVersion() }
        }
    }

    private func loadVersion() async {
        guard let client = session.client else { versionError = "keine Adresse"; return }
        do {
            let v = try await client.version()
            var text = v.version ?? "?"
            if let schema = v.schema { text += " · Datenbank-Stand \(schema)" }
            serverVersion = text
        } catch is CancellationError {
            return
        } catch {
            versionError = "nicht erreichbar"
        }
    }
}

// ENDE SettingsView.swift
