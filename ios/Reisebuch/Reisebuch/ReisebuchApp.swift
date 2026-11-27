//
//  ReisebuchApp.swift
//  Reisebuch
//
//  Created by Philip Pleißner on 27.11.26.
//

import SwiftUI

@main
struct ReisebuchApp: App {
    /// Session und PushController gehören dem App-Delegate (Token und Antippen von Mitteilungen kommen dort an).
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(delegate.session)
                .environment(delegate.push)
                .onOpenURL { delegate.session.handle(url: $0) }
        }
    }
}
