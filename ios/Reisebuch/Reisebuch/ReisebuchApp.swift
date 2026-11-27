//
//  ReisebuchApp.swift
//  Reisebuch
//
//  Created by Philip Pleißner on 27.11.26.
//

import SwiftUI

@main
struct ReisebuchApp: App {
    @State private var session = AppSession()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
        }
    }
}
