//
//  ShareViewController.swift
//  ReisebuchShare
//
//  Teilen-Erweiterung (Auftrag 0.7.0): nimmt PDF, Bilder (bis 10), Dateien und Text an und lädt sie in eine Reise hoch
//  (POST /trips/:id/documents?background=1; die KI liest im Hintergrund, eine Mitteilung meldet die Vorschläge).
//  Anmeldung aus der App Group: Token im Schlüsselbund der Gruppe, Server-Adresse in den gemeinsamen UserDefaults.
//  Kein Zugriff auf andere Daten der App.
//

import SwiftUI
import UIKit

@MainActor
final class ShareViewController: UIViewController {
    private lazy var model = ShareModel(context: extensionContext)

    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        Task { await model.start() }
    }
}

// ENDE ShareViewController.swift
