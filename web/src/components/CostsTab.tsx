import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.ts';
import { costKindInfo, fmtDate, fmtMoney, paymentLabel, todayIso } from '../format.ts';
import type { CostEntry, Cruise, Item, TripCosts, TripDetail } from '../types.ts';
import { Empty, ErrorBox, Spinner } from './ui.tsx';

interface Props {
  detail: TripDetail;
  onOpenItem: (item: Item) => void;
  onOpenCruise: (cruise: Cruise) => void;
}

/**
 * Cost overview of a trip. The numbers come from the server (GET /api/trips/:id/costs), so web and iOS agree.
 * Currencies are never added up or converted; amounts without currency are listed apart.
 */
export function CostsTab({ detail, onOpenItem, onOpenCruise }: Props) {
  const [costs, setCosts] = useState<TripCosts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tripId = detail.trip.id;
  const version = detail.trip.updatedAt;

  useEffect(() => {
    let alive = true;
    api
      .get<TripCosts>(`/api/trips/${tripId}/costs`)
      .then((c) => alive && setCosts(c))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [tripId, version]);

  if (error) return <ErrorBox error={error} />;
  if (!costs) return <Spinner />;

  const open = (source: 'item' | 'cruise', id: string) => {
    if (source === 'cruise') {
      const c = detail.cruises.find((x) => x.id === id);
      if (c) onOpenCruise(c);
    } else {
      const i = detail.items.find((x) => x.id === id);
      if (i) onOpenItem(i);
    }
  };
  const byId = new Map(costs.entries.map((e) => [e.id, e]));
  const today = todayIso();

  if (costs.entries.length === 0) {
    return (
      <div className="stack">
        <Empty icon="💶" title="Noch keine Preise erfasst">
          <p>Trage bei Einträgen und bei der Kreuzfahrt Kosten und Währung ein, dann erscheint hier die Übersicht je Währung und Art, mit bezahlt und offen.</p>
        </Empty>
        <MissingPrices costs={costs} detail={detail} onOpen={open} />
      </div>
    );
  }

  return (
    <div className="stack costs">
      {costs.currencies.map((c) => (
        <section className="card" key={c.currency}>
          <div className="cost-head">
            <h3>{c.currency}</h3>
            <strong className="cost-total">{fmtMoney(c.total, c.currency)}</strong>
          </div>
          <div className="cost-split">
            <span>bezahlt <strong>{fmtMoney(c.paid, c.currency)}</strong></span>
            <span className={c.open > 0 ? 'cost-open' : ''}>offen <strong>{fmtMoney(c.open, c.currency)}</strong></span>
          </div>
          {c.unstated > 0 && (
            <p className="muted small-print">
              {c.unstated === 1 ? '1 Betrag hat' : `${c.unstated} Beträge haben`} keine Angabe zur Zahlung und {c.unstated === 1 ? 'zählt' : 'zählen'} als offen.
            </p>
          )}
          <div className="cost-groups">
            {c.groups.map((g) => {
              const info = costKindInfo(g.kind, g.count);
              return (
                <details key={g.kind} className="cost-group">
                  <summary>
                    <span className="cost-label"><span aria-hidden>{info.icon}</span> {info.label} <span className="muted">({g.count})</span></span>
                    <span className="cost-amount">{fmtMoney(g.total, c.currency)}</span>
                  </summary>
                  <ul className="cost-list">
                    {g.entryIds.map((id) => byId.get(id)).filter((e): e is CostEntry => !!e).map((e) => (
                      <CostRow key={e.id} entry={e} onOpen={() => open(e.source, e.id)} />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </section>
      ))}

      {costs.due.length > 0 && (
        <section className="card">
          <h3>Noch zu zahlen</h3>
          <ul className="cost-list">
            {costs.due.map((e) => (
              <li key={e.id}>
                <button className="cost-row cost-row-due" onClick={() => open(e.source, e.id)}>
                  <span className="cost-title">
                    {e.title}
                    <small className={`cost-due${e.dueDate! < today ? ' overdue' : ''}`}>{e.dueDate! < today ? 'überfällig seit ' : 'bis '}{fmtDate(e.dueDate)}</small>
                  </span>
                  <span className="cost-amount">{fmtMoney(e.open, e.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {costs.withoutCurrency.length > 0 && (
        <section className="card">
          <h3>Ohne Währung</h3>
          <p className="muted small-print">Diese Beträge sind in keiner Summe enthalten. Trage die Währung nach, dann zählen sie mit.</p>
          <ul className="cost-list">
            {costs.withoutCurrency.map((e) => <CostRow key={e.id} entry={e} onOpen={() => open(e.source, e.id)} />)}
          </ul>
        </section>
      )}

      <MissingPrices costs={costs} detail={detail} onOpen={open} />
    </div>
  );
}

function CostRow({ entry: e, onOpen }: { entry: CostEntry; onOpen: () => void }) {
  return (
    <li>
      <button className="cost-row" onClick={onOpen}>
        <span className="cost-date muted">{e.date ? fmtDate(e.date, { day: 'numeric', month: 'short' }) : ''}</span>
        <span className="cost-title">
          {e.title}
          <span className={`badge small pay-${e.paymentStatus ?? 'none'}`}>
            {e.paymentStatus === 'deposit' ? `angezahlt ${fmtMoney(e.paid, e.currency)}` : paymentLabel(e.paymentStatus)}
          </span>
        </span>
        <span className="cost-amount">{fmtMoney(e.cost, e.currency)}</span>
      </button>
    </li>
  );
}

function MissingPrices({ costs, detail, onOpen }: { costs: TripCosts; detail: TripDetail; onOpen: (source: 'item' | 'cruise', id: string) => void }) {
  if (costs.missingPrice.length === 0) return null;
  const title = (id: string) => detail.items.find((i) => i.id === id)?.title ?? detail.cruises.find((c) => c.id === id)?.shipName ?? '';
  return (
    <section className="card">
      <h3>Ohne Preis</h3>
      <p className="muted small-print">Gebuchte Leistungen, bei denen noch kein Preis steht.</p>
      <div className="cost-groups">
        {costs.missingPrice.map((m) => {
          const info = costKindInfo(m.kind, m.count);
          return (
            <details key={m.kind} className="cost-group">
              <summary>
                <span className="cost-label"><span aria-hidden>{info.icon}</span> {info.label}</span>
                <span className="cost-amount muted">{m.count}</span>
              </summary>
              <ul className="cost-list">
                {m.entryIds.map((id) => (
                  <li key={id}>
                    <button className="cost-row" onClick={() => onOpen(m.kind === 'cruise' ? 'cruise' : 'item', id)}>
                      <span className="cost-title">{title(id)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}
