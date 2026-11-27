//
//  Push.swift
//  Reisebuch
//
//  Benachrichtigungen über APNs (Auftrag 0.4.0). Der Server schickt Erinnerungen, Gate-Änderungen und Testnachrichten
//  (docs/API.md, „iPhone-App (APNs)“). Die App meldet ihr Geräte-Token an, zeigt Nachrichten auch bei offener App und
//  öffnet beim Antippen die Reise über denselben Weg wie das Widget (reisebuch://trip/<id>). Kein Badge, nichts gespeichert
//  außer Schalter und letztem Token (kein Geheimnis) in UserDefaults.
//

import Foundation
import Observation
import UIKit
import UserNotifications

struct APNsStatus: Decodable {
    let enabled: Bool
}

struct PushTestResponse: Decodable {
    struct Result: Decodable {
        let deviceName: String?
        let kind: String?
        let ok: Bool
        let error: String?
    }
    let results: [Result]
}

/// Reine Hilfsfunktionen, getestet in PushTests.
enum PushLogic {
    /// Geräte-Token als Hex-Text, klein geschrieben.
    static func hexToken(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    /// Reise aus der `url` einer Nachricht: "/trips/<id>" → id, sonst nil.
    static func tripId(fromPath path: String?) -> String? {
        guard let path else { return nil }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].isEmpty, parts[1] == "trips", !parts[2].isEmpty else { return nil }
        return String(parts[2])
    }

    /// Gleicher Weg wie beim Widget.
    static func appURL(forTripId id: String) -> URL? {
        guard let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) else { return nil }
        return URL(string: "reisebuch://trip/\(encoded)")
    }

    /// Text unter „Testnachricht senden“.
    static func testText(_ results: [PushTestResponse.Result]) -> String {
        if results.isEmpty { return "Kein Gerät angemeldet." }
        if results.allSatisfy(\.ok) { return "Gesendet, sollte gleich ankommen." }
        return results.map { r in
            let name = r.deviceName ?? (r.kind == "app" ? "iPhone-App" : "Browser")
            return r.ok ? "\(name): ok" : "\(name): \(r.error ?? "Fehler")"
        }.joined(separator: "\n")
    }
}

/// Zustand und Abläufe für den Bereich „Benachrichtigungen“ in den Einstellungen.
@Observable
final class PushController {
    private enum Keys {
        static let enabled = "pushOnThisDevice"
        static let token = "apnsDeviceToken"
    }

    let session: AppSession
    /// Schalter „Auf diesem iPhone“.
    private(set) var isOn: Bool
    /// GET /api/push/apns; nil = noch unbekannt.
    private(set) var serverEnabled: Bool?
    /// Hinweis oder Fehler im Bereich (nie als Dialog).
    var message: String?
    var testText: String?
    private(set) var busy = false
    private(set) var testing = false
    /// Beim nächsten Token zusätzlich notifications.enabled fürs Konto setzen (nur beim Einschalten).
    private var enableSettingOnRegister = false

    private var lastToken: String? {
        get { UserDefaults.standard.string(forKey: Keys.token) }
        set { UserDefaults.standard.set(newValue, forKey: Keys.token) }
    }

    init(session: AppSession) {
        self.session = session
        isOn = UserDefaults.standard.bool(forKey: Keys.enabled)
    }

    private func setOn(_ on: Bool) {
        isOn = on
        UserDefaults.standard.set(on, forKey: Keys.enabled)
    }

    func loadServerStatus() async {
        if let status = try? await session.call({ try await $0.apnsStatus() }) {
            serverEnabled = status.enabled
        } else if serverEnabled == nil {
            serverEnabled = false
            message = "Server nicht erreichbar."
        }
    }

    func turnOn() async {
        busy = true
        message = nil
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
        guard granted else {
            busy = false
            message = "Mitteilungen sind nicht erlaubt. Einschalten in den iOS-Einstellungen unter Reisebuch → Mitteilungen."
            return
        }
        setOn(true)
        enableSettingOnRegister = true
        UIApplication.shared.registerForRemoteNotifications()
        // Weiter in didRegister / didFail.
    }

    func turnOff() async {
        busy = true
        message = nil
        if let token = lastToken {
            do {
                try await session.call { try await $0.unregisterAPNs(token: token) }
            } catch {
                message = "Abmelden am Server fehlgeschlagen: \(error.localizedDescription)"
            }
        }
        setOn(false)
        lastToken = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        busy = false
    }

    /// Beim Start: Apple kann das Token ändern, darum neu holen und schicken.
    func registerOnLaunch() async {
        guard session.isLoggedIn, isOn else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(deviceToken: Data) {
        let token = PushLogic.hexToken(deviceToken)
        Task { await send(token: token) }
    }

    private func send(token: String) async {
        guard session.isLoggedIn, isOn else { busy = false; return }
        do {
            try await session.call { try await $0.registerAPNs(token: token) }
            if let old = lastToken, old != token {
                _ = try? await session.call { try await $0.unregisterAPNs(token: old) }
            }
            lastToken = token
            if enableSettingOnRegister {
                try await session.call { try await $0.enableNotificationsSetting() }
                enableSettingOnRegister = false
            }
        } catch {
            if enableSettingOnRegister {
                // Einschalten ist gescheitert: Schalter wieder aus.
                enableSettingOnRegister = false
                setOn(false)
            }
            message = "Anmelden am Server fehlgeschlagen: \(error.localizedDescription)"
        }
        busy = false
    }

    func didFailToRegister(_ error: Error) {
        if enableSettingOnRegister {
            enableSettingOnRegister = false
            setOn(false)
        }
        busy = false
        message = "iOS konnte das iPhone nicht für Mitteilungen anmelden: \(error.localizedDescription)"
    }

    func sendTest() async {
        testing = true
        testText = nil
        do {
            let response = try await session.call { try await $0.pushTest() }
            testText = PushLogic.testText(response.results)
        } catch {
            testText = error.localizedDescription
        }
        testing = false
    }

    /// Vor dem Abmelden: Gerät am Server abmelden, Fehler still. Danach Schalter aus.
    func logout() async {
        if let token = lastToken {
            _ = try? await session.call { try await $0.unregisterAPNs(token: token) }
        }
        reset()
    }

    /// Lokal zurücksetzen (Abmelden, auch nach 401).
    func reset() {
        setOn(false)
        lastToken = nil
        enableSettingOnRegister = false
        message = nil
        testText = nil
        serverEnabled = nil
        busy = false
    }

    /// Antippen einer Nachricht: "/trips/<id>" öffnet die Reise wie das Widget, sonst nur die App.
    func open(path: String?) {
        guard let id = PushLogic.tripId(fromPath: path), let url = PushLogic.appURL(forTripId: id) else { return }
        session.handle(url: url)
    }
}

/// App-Delegate für Token und Mitteilungen; besitzt Session und PushController, damit sie auch beim Kaltstart
/// durch Antippen einer Nachricht schon da sind.
final class AppDelegate: NSObject, UIApplicationDelegate {
    let session = AppSession()
    lazy var push = PushController(session: session)

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        session.onLocalLogout = { [weak self] in self?.push.reset() }
        Task { await push.registerOnLaunch() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        push.didFailToRegister(error)
    }
}

/// UIKit ruft diese Methoden auf dem Hauptthread und verlangt dort auch den Abschluss. Die async-Varianten liefen im
/// Simulator außerhalb davon und brachten die App beim Antippen zum Absturz („Call must be made on main thread“).
extension AppDelegate: UNUserNotificationCenterDelegate {
    /// Auch bei offener App anzeigen.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    /// Antippen: Reise öffnen (gleicher Weg wie das Widget).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        push.open(path: response.notification.request.content.userInfo["url"] as? String)
        completionHandler()
    }
}

// ENDE Push.swift
