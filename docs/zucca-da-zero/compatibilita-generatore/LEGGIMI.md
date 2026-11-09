# Compatibilità tra il generatore di moduli (Super Admin) e il core

Prova che lo schema che esce dal generatore, dopo la pulizia, **si installa nel core e supera controllo e collaudo**. Si fa in due passi separati perché Super Admin e core usano lo stesso nome di variabile per il database.

```bash
node docs/zucca-da-zero/compatibilita-generatore/1-genera.js          # scrive /tmp/moduli-generati.json
node docs/zucca-da-zero/compatibilita-generatore/2-verifica-nel-core.js
```

Risultato del 9 novembre 2026 (tre moduli: Clienti, Ordini con requisiti, automazione, documento e calendario, Consegne): **controllo 100 (29/29), collaudo 100 (20/20)**, con l'automazione che crea una consegna a ogni conferma. Da rifare quando cambia il linguaggio dei blocchi.
