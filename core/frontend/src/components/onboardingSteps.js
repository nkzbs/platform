// Il giro guidato: dove sta cosa, in pochi passi, evidenziando l'elemento vero sulla pagina. Parte a richiesta (dai Primi passi, da Il mio account), mai da solo.
// `target` deve combaciare con un data-tour="..." reale (Sidebar e pagine coinvolte): se non lo trova, ProductTour mostra comunque il passo, centrato.
export const ONBOARDING_STEPS = [
  { page: 'dashboard', target: 'sidebar-dashboard', title: 'Benvenuto', body: 'Questa è la Dashboard: la prima cosa che vedi ogni volta che entri. Puoi aggiungere schede per tenere sott\'occhio i dati che contano. Facciamo un giro veloce.' },
  { page: 'dashboard', target: 'sidebar-nav', title: 'Il menu', body: 'Da qui raggiungi tutto: i moduli che installi (clienti, ordini, spese…), la Libreria per aggiungerne altri e, più in basso, gli strumenti di amministrazione.' },
  { page: 'libreria', target: 'libreria-modelli', title: 'Parti da un modello', body: 'Un modello è un gruppo di moduli già pensati per funzionare insieme (vendite, contabilità, magazzino…). Aprine uno, togli ciò che non ti serve e installa il resto in un colpo solo.' },
  { page: 'libreria', target: 'libreria-nuovo', title: 'Oppure da zero', body: 'Se quello che ti serve non c\'è, lo costruisci tu: campi, collegamenti tra moduli, stati, automazioni. Dopo l\'installazione, «Collega i moduli» ti propone i collegamenti ovvi.' },
  { page: 'builder', target: 'builder-nuovo', title: 'Builder', body: 'Qui modifichi i moduli installati o ne crei di nuovi con il «+». Quando un modulo ti piace, «Proponi alla Libreria» lo manda a Super Admin per renderlo disponibile agli altri.' },
  { page: 'impostazioni', target: 'sidebar-impostazioni', title: 'Impostazioni', body: 'Persone e ruoli, collegamenti (Telegram, WhatsApp, posta), report, AI e funzioni facoltative da accendere solo se ti servono.' },
  { page: 'guida', target: 'sidebar-guida', title: 'Se ti serve aiuto', body: 'La Guida spiega come costruire un modulo passo per passo. Puoi rifare questo giro quando vuoi da Impostazioni → Il mio account.' },
]
