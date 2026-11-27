//
//  LoginView.swift
//  Reisebuch
//
//  Anmeldung: Server-Adresse, Benutzername, Passwort. Das Passwort wird nicht gespeichert.
//

import SwiftUI

struct LoginView: View {
    @Environment(AppSession.self) private var session

    @State private var server = ""
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 8) {
                        Image(systemName: "safari")
                            .font(.system(size: 48))
                            .foregroundStyle(.tint)
                        Text("Reisebuch").font(.title.bold())
                    }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                }

                if let notice = session.loginNotice {
                    Section { Text(notice).foregroundStyle(.secondary) }
                }

                Section("Server") {
                    TextField("Server-Adresse", text: $server)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.URL)
                }

                Section("Anmeldung") {
                    TextField("Benutzername", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.username)
                    SecureField("Passwort", text: $password)
                        .textContentType(.password)
                        .onSubmit { Task { await login() } }
                }

                if let errorText {
                    Section {
                        Label(errorText, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        Task { await login() }
                    } label: {
                        HStack {
                            Spacer()
                            if busy { ProgressView() } else { Text("Anmelden").bold() }
                            Spacer()
                        }
                    }
                    .disabled(busy || username.isEmpty || password.isEmpty || server.isEmpty)
                }
            }
            .navigationTitle("Anmelden")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            if server.isEmpty { server = session.serverAddress }
        }
    }

    private func login() async {
        guard !busy, !username.isEmpty, !password.isEmpty else { return }
        busy = true
        errorText = nil
        defer { busy = false }
        do {
            try await session.login(server: server, username: username.trimmingCharacters(in: .whitespaces),
                                    password: password)
            password = ""
        } catch {
            errorText = error.localizedDescription
        }
    }
}

// ENDE LoginView.swift
