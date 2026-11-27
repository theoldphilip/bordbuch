//
//  TripListView.swift
//  Reisebuch
//
//  Reiseliste: laufende und kommende Reisen oben, vergangene unter „Vergangen“.
//

import SwiftUI

struct TripListView: View {
    @Environment(AppSession.self) private var session

    @State private var trips: [TripSummary] = []
    @State private var loaded = false
    @State private var errorText: String?
    @State private var showSettings = false

    private var today: String { Fmt.todayISO() }

    /// Vergangen ist eine Reise, deren letzter Tag vor heute liegt. Reisen ohne Daten zählen als kommend.
    private func isPast(_ t: TripSummary) -> Bool {
        guard let end = t.effectiveEndDate ?? t.effectiveStartDate else { return false }
        return String(end.prefix(10)) < today
    }

    private var upcoming: [TripSummary] {
        trips.filter { !isPast($0) }.sorted { a, b in
            switch (a.effectiveStartDate, b.effectiveStartDate) {
            case let (x?, y?): return x < y
            case (nil, _?): return false
            case (_?, nil): return true
            default: return a.title.localizedCompare(b.title) == .orderedAscending
            }
        }
    }

    private var past: [TripSummary] {
        trips.filter(isPast).sorted { ($0.effectiveEndDate ?? "") > ($1.effectiveEndDate ?? "") }
    }

    var body: some View {
        NavigationStack {
            List {
                if let errorText {
                    Section {
                        Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    }
                }
                if loaded && trips.isEmpty && errorText == nil {
                    Section {
                        Text("Noch keine Reisen. Reisen legst du in der Web-App an.")
                            .foregroundStyle(.secondary)
                    }
                }
                if !upcoming.isEmpty {
                    Section {
                        ForEach(upcoming) { trip in
                            NavigationLink(value: trip) { TripRow(trip: trip) }
                        }
                    }
                }
                if !past.isEmpty {
                    Section("Vergangen") {
                        ForEach(past) { trip in
                            NavigationLink(value: trip) { TripRow(trip: trip) }
                        }
                    }
                }
            }
            .overlay {
                if !loaded && errorText == nil { ProgressView() }
            }
            .navigationTitle("Reisen")
            .navigationDestination(for: TripSummary.self) { trip in
                TripTimelineView(trip: trip)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Einstellungen")
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            trips = try await session.call { try await $0.trips() }
            errorText = nil
        } catch is CancellationError {
            return
        } catch {
            errorText = error.localizedDescription
        }
        loaded = true
    }
}

extension TripSummary: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

private struct TripRow: View {
    let trip: TripSummary

    var body: some View {
        let kind = Labels.tripKind(trip.kind)
        HStack(alignment: .top, spacing: 12) {
            Text(kind.icon).font(.title2).accessibilityLabel(kind.label)
            VStack(alignment: .leading, spacing: 3) {
                Text(trip.title).font(.headline)
                Text(Fmt.range(trip.effectiveStartDate, trip.effectiveEndDate))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if trip.kind == "cruise" || trip.kind == nil, let ships = trip.ships, !ships.isEmpty {
                    Text(ships.joined(separator: ", "))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

// ENDE TripListView.swift
