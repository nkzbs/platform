# Guida al bot Telegram

Lo stesso bot è dentro ogni progetto Platform — cosa sa fare dipende da quali moduli ha quel
tenant e come li hai dichiarati (Builder → Ruoli del modulo): niente qui sotto è specifico di
un progetto, tutto si attiva o resta spento da solo in base a cosa c'è davvero.

## Collegarlo

L'admin collega il bot **una volta sola** per tutto il progetto: Impostazioni → Connessioni →
Telegram, incollando il codice segreto avuto da [@BotFather](https://t.me/BotFather).

Da lì, **ogni persona collega il proprio telefono**: Impostazioni → Il mio account → genera un
codice monouso (valido 10 minuti), scrivilo al bot. Una chat non collegata a nessun utente
riceve solo le istruzioni per collegarsi — mai dati, mai un'azione.

Ci si scollega in qualunque momento dall'app, o scrivendo `/scollega` al bot.

## Due modi di parlargli

- **Comandi fissi**: `/pagare`, `/scadute`, `/smistare` per i report disponibili; `/menu` apre un
  menu a bottoni con sottomenu — si ricostruisce da ciò che puoi fare *ora*: un report spento o
  un modulo che non hai semplicemente non compare, nessun bottone a vuoto.
- **Frase libera**: scrivi come parleresti a una persona ("ho speso 20 euro di benzina", "quanto
  devo ancora in totale?"). Il bot sceglie UNA azione da un elenco chiuso (sotto) — non è una
  chat generica, non esegue mai niente fuori da quell'elenco.

## Ogni scrittura è una proposta

Il bot non scrive mai da solo: descrive cosa farebbe e aspetta un tocco su **✅ Conferma** (o
propone più candidati, se più righe assomigliano a quello che hai scritto). La proposta vale
**15 minuti**, **una volta sola**, **solo per chi l'ha chiesta**.

Quando esegue, lo fa con la tua utenza reale — stessi permessi, stessa regola "vedo solo le mie
righe" se il tuo ruolo ce l'ha, stesse automazioni che scatterebbero scrivendo dall'app.

## Cosa può fare

**Spese, entrate, bollette**
- Registrare una spesa o un'entrata a frase libera, con categoria se il modulo la prevede.
- Leggere la foto di uno scontrino o il PDF di una bolletta (se il potenziamento AI è acceso sul
  modulo) e proporre la riga — tu confermi prima che nasca.
- Segnare pagata o riaprire una voce; smistare una bolletta appena arrivata (un pagamento, a
  rate, o già pagata).

**Chiedere ai dati**
- Domande sui tuoi numeri, anche di confronto o proiezione: "quanto ho speso di benzina a
  settembre?", "rispetto al mese scorso?", "di questo passo quanto spenderò entro fine mese?".
  Sempre una query strutturata sui moduli che vedi tu, mai SQL libero.

**Timbrature** (se c'è un modulo di presenze dichiarato)
- Timbrare entrata/uscita a voce ("sono entrata", "uscita alle 18:30"), chiedere le ore di oggi,
  della settimana o del mese, compresi gli straordinari.

**Busta paga** (se c'è un modulo di cedolini dichiarato)
- Ferie/permessi/ROL residui, le ore di un mese preciso, l'ultima busta paga (file allegato
  incluso, se c'è), quali mesi mancano, una domanda libera sul dettaglio di una voce.
- Un riepilogo ore-pagate-contro-ore-timbrate su più mesi, e ferie+permessi+ROL insieme in un
  colpo solo.

**Un costo condiviso con un'altra persona** (se configurato)
- Chi deve soldi a chi su un costo fisso ricorrente diviso tra due persone (es. un affitto),
  confrontando i versamenti reali di ciascuno con una quota mensile configurabile.

## Cosa NON fa, di proposito

- **Mai** eliminare una riga, modificare un campo libero, toccare utenti/impostazioni/backup.
- Le foto si leggono solo per gli scontrini — il resto (bollette, documenti) va mandato come PDF.
- **Niente 2FA sul bot**: il telefono collegato e sbloccato basta ad agire. Per questo le azioni
  possibili sono volutamente poche, e si revocano scollegando il telefono in qualunque momento.
- I messaggi stanno sui server di Telegram, **non cifrati end-to-end** — niente password o dati
  particolarmente sensibili in chat.

## Limiti

- Al massimo **20 messaggi al minuto** per chat (anti-abuso).
- Le frasi libere che passano dall'AI sono limitate a **8 al minuto** per chat — oltre, il bot
  chiede di aspettare un momento prima di continuare.

---

*Questa guida vive anche dentro l'app: Guida → Riferimento → Bot Telegram, sempre aggiornata
insieme al codice.*
