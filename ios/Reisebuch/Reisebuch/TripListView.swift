//
//  TripListView.swift
//  Reisebuch
//
//  Reiseliste: laufende und kommende Reisen oben, vergangene unter „Vergangen“.
//  Zeigt sofort die gespeicherte Liste, lädt dann vom Server; offline bleibt die gespeicherte Liste mit Band stehen.
//

import SwiftUI

struct TripListView: View {
    @Environment(AppSession.self) private var session

    @State private var trips: [TripSummary] = []
    @State private var loaded = false
    @State private var errorText: String?
    @State private var showSettings = false
    /// Gesetzt, solange gespeicherte Daten gezeigt werden, weil der Server nicht erreichbar ist.
    @State private var offlineSince: Date?
    @State private var startedUp = false

    private var today: String { Fmt.todayISO() }

    private func isPast(_ t: TripSummary) -> Bool { TripDates.isPast(t, today: today) }

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
                if let offlineSince {
                    OfflineBanner(savedAt: offlineSince)
                }
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
            .task {
                if !startedUp {
                    startedUp = true
                    if let cached = session.cachedTrips() {
                        trips = cached.value
                        loaded = true
                    }
                    Task { await session.refreshAIStatus() }
                }
                await load()
            }
        }
    }

    private func load() async {
        do {
            let fresh = try await session.fetchTrips()
            trips = fresh
            errorText = nil
            offlineSince = nil
            loaded = true
            // Abläufe laufender und kommender Reisen für offline vorladen, ohne die Liste warten zu lassen.
            Task { await session.prefetchTimelines(for: fresh) }
        } catch is CancellationError {
            return
        } catch {
            if let cached = session.cachedTrips() {
                trips = cached.value
                if case APIError.unreachable = error {
                    offlineSince = cached.savedAt
                    errorText = nil
                } else {
                    offlineSince = nil
                    errorText = error.localizedDescription
                }
            } else {
                errorText = error.localizedDescription
            }
            loaded = true
        }
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

/// Ruhiges Band über gespeicherten Daten: „Offline · Stand Fr., 27. Nov., 14:32“.
struct OfflineBanner: View {
    let savedAt: Date

    var body: some View {
        Section {
            Label("Offline · Stand \(Fmt.stamp(savedAt))", systemImage: "icloud.slash")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }
}

// ENDE TripListView.swift
