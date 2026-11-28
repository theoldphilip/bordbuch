//
//  ReisebuchApp.swift
//  Reisebuch
//
//  Created by Philip Pleißner on 27.11.26.
//

import SwiftUI

@main
struct ReisebuchApp: App {
    /// Session, PushController und PlaceReminderController gehören dem App-Delegate (Token und Antippen von Mitteilungen kommen dort an).
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(delegate.session)
                .environment(delegate.push)
                .environment(delegate.places)
                .onOpenURL { delegate.session.handle(url: $0) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { delegate.didEnterBackground() }
        }
    }
}
