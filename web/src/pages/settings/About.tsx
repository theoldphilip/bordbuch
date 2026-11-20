import { reloadApp, useVersion } from '../../hooks/useVersion.ts';

export function AboutSettings() {
  const { info, outdated } = useVersion();
  const built = info?.builtAt ? new Date(info.builtAt).toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  return (
    <section className="card">
      <h3>Über Bordbuch</h3>
      {outdated && (
        <div className="alert alert-error">
          Die App auf diesem Gerät ist älter als der Server (App {__APP_VERSION__}, Server {info?.version}). Lade sie neu, um die neue Version zu bekommen.
        </div>
      )}
      <dl className="about">
        <dt>Version</dt>
        <dd><strong>{info?.version ?? '…'}</strong></dd>
        <dt>App auf diesem Gerät</dt>
        <dd>{__APP_VERSION__}{info && !outdated && <small className="muted"> · aktuell</small>}</dd>
        <dt>Gebaut am</dt>
        <dd>{info ? (built ?? 'Entwicklungsstand (kein Docker-Image)') : '…'}</dd>
        <dt>Datenbank-Stand</dt>
        <dd>{info?.schema ?? '…'}</dd>
        <dt>Adresse</dt>
        <dd>{location.origin}</dd>
      </dl>
      <div>
        <button className={outdated ? 'btn btn-primary' : 'btn'} onClick={reloadApp}>App neu laden</button>
        <p className="muted small-print">Leert den Zwischenspeicher der App und lädt sie neu. Hilft, wenn nach einem Update noch die alte Oberfläche erscheint.</p>
      </div>
    </section>
  );
}
