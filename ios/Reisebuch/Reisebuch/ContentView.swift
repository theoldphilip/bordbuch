//
//  ContentView.swift
//  Reisebuch
//
//  Wurzel: Anmeldung oder Reiseliste, je nach Anmeldezustand.
//

import SwiftUI

struct ContentView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        if session.isLoggedIn {
            TripListView()
        } else {
            LoginView()
        }
    }
}

#Preview {
    ContentView().environment(AppSession())
}
