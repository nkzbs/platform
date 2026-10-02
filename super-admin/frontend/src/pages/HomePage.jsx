import React, { useState, useEffect, useRef } from 'react'
import PlatformLogo from '../components/PlatformLogo'
import LoginModal from '../components/Home/LoginModal'
import './HomePage.css'

// Stesso hook di reveal-on-scroll della brochure statica (platform-core-brochure.html),
// qui come hook React invece che uno script globale — un IntersectionObserver per
// sezione, si stacca da solo una volta rivelata (una sola animazione, non ripetuta
// ad ogni scroll su e giù).
function useReveal() {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setVisible(true); io.unobserve(e.target) } })
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, visible]
}

const CHAIN_BLOCKS = [
  { label: 'Campo', color: '#2563EB' },
  { label: 'Relazione', color: '#7C3AED' },
  { label: 'Workflow', color: '#10B981' },
  { label: 'Allegati', color: '#06B6D4' },
  { label: 'Permessi', color: '#FFB84D' },
  { label: 'Formula', color: '#F87171' },
  { label: 'Automazione', color: '#FBBF24' },
]

function BuilderChain() {
  const [started, setStarted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setStarted(true), 400); return () => clearTimeout(t) }, [])
  return (
    <div className="flex items-center gap-0 flex-wrap p-7 border border-gray-800 rounded-2xl bg-[#12161F] overflow-x-auto">
      {CHAIN_BLOCKS.map((b, i) => (
        <React.Fragment key={b.label}>
          {i > 0 && (
            <span className={'home-chain-arrow text-gray-600 px-1.5 flex-shrink-0' + (started ? ' in' : '')} style={{ transitionDelay: (i * 120) + 'ms' }}>→</span>
          )}
          <div
            className={'home-chain-block font-mono-ui text-[15px] font-medium flex items-center gap-3 px-5 py-4 rounded-lg whitespace-nowrap flex-shrink-0' + (started ? ' in' : '')}
            style={{
              backgroundColor: b.color + '24', border: '1px solid ' + b.color + '59', color: b.color,
              transitionDelay: (i * 120) + 'ms',
            }}
          >
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color }} />
            {b.label}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}

function Section({ children, className = '' }) {
  const [ref, visible] = useReveal()
  return <div ref={ref} className={'home-reveal' + (visible ? ' in' : '') + ' ' + className}>{children}</div>
}

const BLOCKS = [
  { n: '01', cat: 'Dati', title: 'Campo', color: '#2563EB', desc: 'Il mattone base: testo, numero, data, selezione, mappa, file, cifrato — un campo per ogni informazione. I campi data supportano navigazione mese/anno e la regola del 27 per la pianificazione.' },
  { n: '02', cat: 'Relazioni', title: 'Relazione', color: '#7C3AED', desc: 'Collega un modulo a un altro. Ordini → Cliente, Fatture → Agente — il selettore mostra il nome, mai un ID grezzo. Supporta quick-create inline.' },
  { n: '03', cat: 'Workflow', title: 'Stato & Transizione', color: '#10B981', desc: 'Definisci le fasi di un record — Bozza, Confermato, Spedito — e chi può farle avanzare, ruolo per ruolo. I campi select diventano tab di filtro con un flag.' },
  { n: '04', cat: 'Dati', title: 'Allegati tipizzati', color: '#06B6D4', desc: 'Ogni record può avere allegati con tipo configurabile (es. Fattura, Prova pagamento). Upload, lista e cancellazione inline nella modal di dettaglio.' },
  { n: '05', cat: 'Permessi', title: 'Permessi', color: '#FFB84D', desc: '"Solo i propri" per chi deve vedere solo il suo lavoro. Matrice ruolo × azione, con enforcement reale lato server.' },
  { n: '06', cat: 'Calcolo', title: 'Formula', color: '#F87171', descMono: 'sum(ordini.totale) − sum(spese.importo)', desc: 'Aggregazioni multi-hop attraverso le relazioni, valutate sui dati reali — non un placeholder testuale.' },
  { n: '07', cat: 'Automazione', title: 'Automazione', color: '#FBBF24', desc: 'Trigger su eventi reali, rami Se/Altrimenti annidati senza limite, azioni verso i servizi connessi.' },
]

const PRINCIPLES = [
  { tag: 'Schema, non codice', title: 'Ogni modulo è schema_json', body: 'Nessun concetto specifico di settore — provvigioni, margini, crediti — è mai una funzione scritta a mano. È sempre un\'aggregazione dentro lo schema, letta dallo stesso motore generico per qualunque verticale.' },
  { tag: 'Numeri veri', title: 'Zero dati finti, mai', body: 'I conteggi installazioni nel Registro moduli vengono dal log di audit reale, non da un contatore inventato. Nessuna stella, nessun voto simulato.' },
  { tag: 'Isolamento reale', title: 'Un container per tenant', body: 'Ogni cliente gira nel proprio container Docker dedicato, con il proprio database — non righe condivise filtrate a runtime.' },
  { tag: 'Enforcement, non solo interfaccia', title: 'I permessi vivono nel backend', body: 'Un ruolo senza accesso a un record non può ottenerlo forzando una richiesta — la regola è applicata dove i dati vengono letti e scritti.' },
]

const VERTICALS = [
  { n: '01', name: 'Platform Core', status: 'Attivo', color: '#10B981', desc: 'Builder, Store, permessi, workflow, formule, automazioni, licenze, backup — la base comune a ogni istanza. Vault PIN cifrato, calendario, filter tab, navigazione mese.' },
  { n: '02', name: 'Platform Finance', status: 'Attivo', color: '#10B981', desc: 'Gestionale finanze personali e familiari — Conti, Spese, Entrate, Debiti, Pagamenti (casa/personale), Ricorrenti, Note, Vault. Allegati tipizzati (fattura, prova pagamento) su ogni movimento.' },
  { n: '03', name: 'Platform Coffee', status: 'Attivo', color: '#10B981', desc: 'Gestionale per torrefazioni Ho.Re.Ca. — Clienti, Agenti, Prodotti, Ordini, Fatture, Magazzino verde, Lotti tostatura, Furgoni, CRM, GDPR. 18 moduli intercollegati, costruiti dal Builder.' },
  { n: '04', name: 'Prossimo verticale', status: 'Pianificato', color: '#565F72', desc: 'Qualunque settore con moduli, relazioni e workflow propri — la stessa base, un catalogo diverso. I connettori Gmail e WhatsApp sono già nella roadmap come moduli OAuth.' },
]

function HomePage({ onLogin }) {
  const [showLogin, setShowLogin] = useState(false)

  return (
    <div className="home-page min-h-screen bg-[#0B0E14] text-[#F3F4F6]">
      {/* ── nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-40 border-b border-gray-800" style={{ background: 'rgba(11,14,20,0.82)', backdropFilter: 'blur(10px)' }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <PlatformLogo size={28} />
            <span className="font-display font-semibold text-[15px]">Platform Core</span>
          </div>
          <div className="flex items-center gap-8">
            <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
              <a href="#come-funziona" className="hover:text-ink transition">Come funziona</a>
              <a href="#principi" className="hover:text-ink transition">Principi</a>
              <a href="#architettura" className="hover:text-ink transition">Architettura</a>
              <a href="#verticali" className="hover:text-ink transition">Verticali</a>
            </div>
            <button onClick={() => setShowLogin(true)} className="font-display text-sm font-medium bg-white text-[#0B0E14] px-4 py-2 rounded-lg hover:-translate-y-0.5 transition flex-shrink-0">
              Accedi
            </button>
          </div>
        </div>
      </nav>

      {/* ── hero ── */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono-ui text-sm uppercase tracking-wider text-gray-600 mb-5 flex items-center gap-2.5">
            <span className="w-5 h-px bg-gray-700" />Piattaforma gestionale multi-tenant
          </div>
          <h1 className="font-display font-bold text-[clamp(36px,7vw,68px)] leading-[1.05] max-w-3xl mb-6">
            Il gestionale lo <span style={{ background: 'linear-gradient(90deg,#2563EB,#7C3AED)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>disegni</span>, non lo programmi.
          </h1>
          <p className="text-xl text-gray-400 max-w-xl mb-10">
            Platform Core è la base da cui nasce ogni gestionale verticale: moduli, relazioni, workflow, permessi, formule e automazioni si costruiscono a blocchi, dentro il Builder.
          </p>
          <div className="flex items-center gap-4 flex-wrap mb-14">
            <button onClick={() => setShowLogin(true)} className="font-display text-sm font-semibold bg-white text-[#0B0E14] px-6 py-3.5 rounded-lg hover:-translate-y-0.5 transition">
              Accedi al tuo spazio →
            </button>
            <a href="#architettura" className="font-display text-sm font-medium text-gray-400 border border-gray-800 px-6 py-3.5 rounded-lg hover:border-gray-600 hover:text-ink transition">
              Architettura tecnica
            </a>
          </div>
          <BuilderChain />
        </div>
      </section>

      {/* ── come funziona ── */}
      <section id="come-funziona" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <Section className="max-w-xl mb-14">
            <div className="font-mono-ui text-sm uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-2.5"><span className="w-5 h-px bg-gray-700" />Il Builder</div>
            <h2 className="font-display font-bold text-4xl mb-5">Sette blocchi. Nessuna riga di codice.</h2>
            <p className="text-lg text-gray-400">Ogni modulo — Ordini, Clienti, Agenti, Pagamenti, qualunque cosa serva — è una sequenza di questi blocchi. Platform Finance e Platform Coffee sono costruiti interamente così.</p>
          </Section>
          <Section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-800 border border-gray-800 rounded-2xl overflow-hidden">
            {BLOCKS.map((b) => (
              <div key={b.n} className="bg-[#12161F] p-7 relative">
                <div className="absolute top-0 left-0 w-full h-[3px]" style={{ backgroundColor: b.color }} />
                <div className="font-mono-ui text-xs text-gray-600 mb-4">{b.n} · {b.cat}</div>
                <div className="font-display font-semibold text-xl mb-3">{b.title}</div>
                {b.descMono && <div className="font-mono-ui text-[13px] mb-2" style={{ color: b.color }}>{b.descMono}</div>}
                <p className="text-base text-gray-400">{b.desc}</p>
              </div>
            ))}
          </Section>
        </div>
      </section>

      {/* ── principi ── */}
      <section id="principi" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <Section className="max-w-xl mb-14">
            <div className="font-mono-ui text-sm uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-2.5"><span className="w-5 h-px bg-gray-700" />Principi architetturali</div>
            <h2 className="font-display font-bold text-4xl mb-5">Onestà come vincolo tecnico, non come promessa.</h2>
          </Section>
          <Section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="border border-gray-800 rounded-2xl p-8 bg-[#12161F]">
                <div className="font-mono-ui text-[11px] uppercase tracking-wide text-gray-600 mb-3.5">{p.tag}</div>
                <div className="font-display font-semibold text-2xl mb-3">{p.title}</div>
                <p className="text-base text-gray-400">{p.body}</p>
              </div>
            ))}
          </Section>
        </div>
      </section>

      {/* ── architettura ── */}
      <section id="architettura" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <Section className="max-w-xl mb-14">
            <div className="font-mono-ui text-sm uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-2.5"><span className="w-5 h-px bg-gray-700" />Sotto il cofano</div>
            <h2 className="font-display font-bold text-4xl mb-5">Un Super Admin, molti tenant isolati.</h2>
            <p className="text-lg text-gray-400">Ogni istanza cliente è un container indipendente, provisionato e sorvegliato da un pannello centrale.</p>
          </Section>
          <Section className="border border-gray-800 rounded-2xl p-10 bg-[#12161F] overflow-x-auto">
            <svg viewBox="0 0 900 300" className="mx-auto" style={{ minWidth: 780 }}>
              <rect x="360" y="20" width="180" height="60" rx="10" fill="#161B26" stroke="#2563EB" strokeWidth="1.5" />
              <text x="450" y="45" textAnchor="middle" fill="#F3F4F6" fontFamily="Space Grotesk, sans-serif" fontSize="14" fontWeight="600">Super Admin</text>
              <text x="450" y="62" textAnchor="middle" fill="#8B93A7" fontFamily="IBM Plex Mono, monospace" fontSize="10">domini · licenze · backup</text>
              <line x1="450" y1="80" x2="450" y2="115" stroke="#232A38" strokeWidth="1.5" />
              <line x1="140" y1="115" x2="760" y2="115" stroke="#232A38" strokeWidth="1.5" />
              <line x1="140" y1="115" x2="140" y2="145" stroke="#232A38" strokeWidth="1.5" />
              <line x1="450" y1="115" x2="450" y2="145" stroke="#232A38" strokeWidth="1.5" />
              <line x1="760" y1="115" x2="760" y2="145" stroke="#232A38" strokeWidth="1.5" />
              {[{ x: 50, name: 'Finance', color: '#10B981', port: '4001' }, { x: 360, name: 'Coffee', color: '#795548', port: '4002' }, { x: 670, name: 'Prossimo', color: '#565F72', port: '—' }].map((t) => (
                <g key={t.name}>
                  <rect x={t.x} y="145" width="180" height="85" rx="10" fill="#161B26" stroke={t.color} strokeWidth="1.5" />
                  <text x={t.x + 90} y="172" textAnchor="middle" fill="#F3F4F6" fontFamily="Space Grotesk, sans-serif" fontSize="13" fontWeight="600">{t.name}</text>
                  <text x={t.x + 90} y="190" textAnchor="middle" fill="#8B93A7" fontFamily="IBM Plex Mono, monospace" fontSize="10">platform-core</text>
                  <text x={t.x + 90} y="206" textAnchor="middle" fill="#565F72" fontFamily="IBM Plex Mono, monospace" fontSize="9">porta {t.port} · db proprio</text>
                </g>
              ))}
              <rect x="370" y="256" width="160" height="32" rx="8" fill="none" stroke="#232A38" strokeDasharray="3 3" />
              <text x="450" y="276" textAnchor="middle" fill="#565F72" fontFamily="IBM Plex Mono, monospace" fontSize="10">nginx · routing per dominio</text>
            </svg>
          </Section>
        </div>
      </section>

      {/* ── verticali ── */}
      <section id="verticali" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <Section className="max-w-xl mb-14">
            <div className="font-mono-ui text-sm uppercase tracking-wider text-gray-600 mb-4 flex items-center gap-2.5"><span className="w-5 h-px bg-gray-700" />Dal core al verticale</div>
            <h2 className="font-display font-bold text-4xl mb-5">Un settore in più è un catalogo in più.</h2>
          </Section>
          <Section>
            {VERTICALS.map((v, i) => (
              <div key={v.n} className={'flex gap-7 py-7 items-baseline flex-wrap' + (i < VERTICALS.length - 1 ? ' border-b border-gray-800' : '')}>
                <div className="font-mono-ui text-[13px] text-gray-600 w-8">{v.n}</div>
                <div className="font-display font-semibold text-xl w-full sm:w-48 flex-shrink-0">{v.name}</div>
                <div className="text-base text-gray-400 flex-1">{v.desc}</div>
                <div className="font-mono-ui text-[11px] px-2.5 py-1 rounded-full flex-shrink-0" style={{ backgroundColor: v.color + '2A', color: v.color, border: '1px solid ' + v.color + '66' }}>{v.status}</div>
              </div>
            ))}
          </Section>
        </div>
      </section>

      {/* ── footer / cta ── */}
      <footer className="border-t border-gray-800 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <Section className="text-center max-w-xl mx-auto mb-20">
            <h2 className="font-display font-bold text-3xl mb-5">Costruito a blocchi.<br />Verificato come codice.</h2>
            <p className="text-gray-400 mb-9">Nessuna promessa di roadmap spacciata per funzionalità esistente.</p>
            <button onClick={() => setShowLogin(true)} className="font-display text-sm font-semibold bg-white text-[#0B0E14] px-6 py-3.5 rounded-lg hover:-translate-y-0.5 transition">
              Accedi al tuo spazio →
            </button>
          </Section>
          <div className="flex justify-between items-center flex-wrap gap-4 text-xs text-gray-600">
            <div>Platform Core</div>
            <div>© {new Date().getFullYear()}</div>
          </div>
        </div>
      </footer>

      {showLogin && <LoginModal onLogin={onLogin} onClose={() => setShowLogin(false)} />}
    </div>
  )
}

export default HomePage
