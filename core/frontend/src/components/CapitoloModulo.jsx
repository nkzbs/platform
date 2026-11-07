import React from 'react'
import RichText from './RichText'
import Icon from './Icon'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'
import { daSchema } from '../lib/guida-da-schema'

// Il capitolo di guida di UN modulo: i testi scritti dal pacchetto (a cosa serve, come si usa, consigli) + ciò che l'app ricava dallo schema (percorso, dati chiave, cosa serve per ogni passaggio,
// documenti, azioni «da attivare»). Usato dalla pagina Guida e dall'aiuto «?» dentro il modulo.
const Titolo = ({ children }) => <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">{children}</div>

export default function CapitoloModulo({ modulo, capitolo }) {
  let g = null
  try { g = daSchema(parseSchemaFrontend(modulo.schema_json)) } catch (e) { g = null }
  const c = capitolo || {}
  return (
    <div className="space-y-5">
      {c.scopo && <p className="text-sm text-gray-300 leading-relaxed"><RichText text={c.scopo} /></p>}
      {(c.come_si_usa || []).length > 0 && (
        <div>
          <Titolo>Come si usa</Titolo>
          <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-300 leading-relaxed marker:text-accent">
            {c.come_si_usa.map((p, i) => <li key={i}><RichText text={p} /></li>)}
          </ol>
        </div>
      )}
      {g && g.percorso.length > 1 && (
        <div>
          <Titolo>Dove si trova la pratica</Titolo>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {g.percorso.map((s, i) => (<React.Fragment key={s}>{i > 0 && <Icon name="chevron-right" size={11} className="text-gray-600" />}<span className="px-2.5 py-1 rounded-full bg-surface-page border border-gray-800 text-ink">{s}</span></React.Fragment>))}
          </div>
        </div>
      )}
      {g && g.passaggi.length > 0 && (
        <div>
          <Titolo>Cosa serve per ogni passaggio</Titolo>
          <div className="space-y-1.5">
            {g.passaggi.map((p) => (
              <div key={p.stato} className="text-sm bg-surface-page rounded-lg px-3 py-2">
                <span className="text-ink font-medium">{p.stato}</span>
                <span className={'ml-2 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ' + (p.bloccante ? 'bg-amber-400/15 border-amber-500/50 text-ink' : 'border-gray-700 text-gray-500')}>{p.bloccante ? 'obbligatorio' : 'promemoria'}</span>
                <div className="text-xs text-gray-400 mt-0.5">{p.servono.join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {g && g.datiChiave.length > 0 && (
        <div><Titolo>In evidenza in alto nella scheda</Titolo><div className="text-sm text-gray-300">{g.datiChiave.join(' · ')}</div></div>
      )}
      {g && g.documenti.length > 0 && (
        <div><Titolo>Documenti che puoi preparare</Titolo><div className="text-sm text-gray-300">{g.documenti.join(' · ')}<span className="text-gray-500"> — il testo si rivede prima di spedirlo.</span></div></div>
      )}
      {g && g.azioni.length > 0 && (
        <div>
          <Titolo>Funzioni collegate a servizi esterni</Titolo>
          <div className="space-y-1.5">
            {g.azioni.map((a) => (
              <div key={a.label} className="text-sm bg-surface-page rounded-lg px-3 py-2">
                <span className="text-ink font-medium">{a.label}</span>
                {a.daAttivare && <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-400/15 border border-amber-500/50 text-ink rounded px-1.5 py-0.5">da attivare</span>}
                <div className="text-xs text-gray-400 mt-0.5">{a.descrizione}{a.daAttivare && a.servizio ? ' Serve ' + a.servizio + '.' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {g && g.calendario && <div className="text-sm text-gray-300"><Icon name="calendar" size={13} className="inline mr-1.5 text-accent" />Questo modulo si vede anche a <b>calendario</b>: tocca un giorno per l'elenco.</div>}
      {(c.consigli || []).length > 0 && (
        <div>
          <Titolo>Consigli</Titolo>
          <ul className="space-y-1.5 list-disc pl-5 text-sm text-gray-400 leading-relaxed marker:text-gray-600">{c.consigli.map((p, i) => <li key={i}><RichText text={p} /></li>)}</ul>
        </div>
      )}
    </div>
  )
}
