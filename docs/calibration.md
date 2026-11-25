# Calibrage des pénalités (phase 1)

Généré par `pnpm calibrate` le 2026-11-25 13:45 UTC, graphe du 2026-11-23 (D = 3 m). Pénalités de départ du §7. Carte : `docs/calibration-map.html`. Ne pas éditer à la main : les commentaires vont dans `docs/calibration-notes.md`, inséré ci-dessous.

> **25/11/2026 : modèle d'accès piéton.** Les commentaires ci-dessous datent des règles vélo (contresens et voies piétonnes « à pied », trottoirs exclus). Les tableaux générés plus bas reflètent le graphe actuel, où tout se roule dans les deux sens.

## Lecture et décisions proposées (phase 1)

Rédigé le 2026-11-24. Les points marqués **à valider** attendent ta réponse avant la phase 2.

### Les cinq paires en un tableau

Mètres de pavé et détour par rapport au niveau Court.

| Paire | Court | Équilibré | Lisse | Zéro pavé |
| --- | ---: | ---: | ---: | ---: |
| 1. Duomo → Darsena | 878 m | 196 m (+28 %) | 44 m (+62 %) | 2 m (+72 %) |
| 2. Castello → Porta Venezia | 919 m | 67 m (+19 %) | 74 m (+28 %) | 0 m (+51 %) |
| 3. Centrale → Bocconi | 804 m | 55 m (+1 %) | 55 m (+1 %) | 0 m (+20 %) |
| 4. Medaglie d'Oro → Sant'Ambrogio | 1 180 m | 338 m (+8 %) | 118 m (+22 %) | 66 m (+39 %) |
| 5. Lambrate → Leonardo da Vinci (témoin) | 0 m | 0 m (0 %) | 0 m (−1 %) | 0 m (−1 %) |

- **Lisse** retire 90 à 95 % du pavé, pour un détour de +1 % à +62 %. Les paires qui traversent le centre historique (1 et 2) paient le plus : le cœur de la ville est dense en pavé, le contournement passe par la cerchia dei Navigli.
- **Équilibré** laisse nettement plus de pavé que Lisse sur les paires 1 et 4 (196 m contre 44, 338 m contre 118), pour un détour environ deux fois moindre. Sur la paire 2, il en laisse même un peu moins que Lisse (67 m contre 74) parce qu'il l'échange contre 1,06 km de dalles, peu pénalisées à ce niveau ; Lisse, qui pénalise davantage les dalles, préfère 74 m de pavé.
- **Zéro pavé** coûte +20 % à +72 % et pousse le vélo jusqu'à 154 m pour éviter les derniers mètres.
- **Témoin** : aucun pavé à aucun niveau, comme attendu. Lisse et Zéro pavé y sont 22 m plus courts que Court : ils évitent 97 m le long des rails (157 → 60 m) en poussant 73 m de plus. Court minimise une distance où chaque mètre à pied compte 3,5 fois, donc il préfère rouler 22 m de plus.

### Décision 1 : garder les pénalités de départ (à valider)

Les valeurs du §7 produisent des écarts nets et ordonnés entre niveaux. Je propose de les garder telles quelles et de les juger à l'usage (recette de la phase 6) plutôt que de les retoucher sur cinq trajets. Si Lisse te paraît trop détourné au centre, le levier est la pénalité `PAVE` du niveau 2 (4 → 3).

### Décision 2 : croisements obliques entre 10° et 45° (à valider)

Le brief pénalise les croisements de rails à moins de 45°. J'ai ajouté un plancher à 10° : en dessous, ce n'est pas un croisement mais un rail dessiné le long de la rue qui recoupe son axe. Ces cas sont déjà pénalisés par `railLen`, et sans le plancher ils seraient comptés deux fois. Résultat : 994 croisements obliques dans le graphe.

### Décision 3 : alléger le graphe en phase 2 (à valider)

Le fichier fait 16,9 Mo (8,3 Mo compressé au téléchargement), au-dessus de l'ordre de 10 Mo du brief mais sous le seuil d'alerte de 30 Mo. Les coordonnées pèsent 5,2 Mo, dont 3,1 Mo répètent les extrémités de tronçon déjà stockées dans les nœuds. Je propose de les retirer quand je brancherai le téléchargement (phase 2), ce qui ramène le fichier vers 14 Mo.

### Invariant du §12 sur la distance

« distance(niveau 3) ≥ distance(niveau 0) » n'est pas garanti dès que le vélo est poussé, pour la raison vue sur le témoin. Le test vérifie donc la forme exacte : le trajet du niveau 3, évalué avec le coût du niveau 0, n'est jamais moins cher que celui du niveau 0. Il exige en plus que toute exception sur la distance brute s'explique par davantage de marche. Sur 200 paires aléatoires : 3 exceptions, toutes expliquées par la marche ; aucune paire où le niveau 3 aurait plus de pavé que le niveau 0.

### Autres constats

- Graphe : 152 013 nœuds, 377 806 arcs, construit en 1,7 s. La plus grande composante garde 6 657 km sur 6 954 ; les 297 km écartés sont 3 211 petits morceaux isolés (allées, cours privées).
- Rails : 67,6 km de tronçons marqués, dont 3,1 km par le tag local `surface_bike=*:rails`.
- Temps : 2 ms par requête complète (accrochage + trois calculs) sur ce Mac, chargement du graphe et des index en 57 ms. Le budget iPhone de 500 ms laisse une large marge, à mesurer en phase 3.
- Noms des lieux : OSM écrit « Piazza Ventiquattro Maggio », « Piazzale Medaglie d'Oro », « Milano Centrale », et la basilique Sant'Ambrogio n'existe que comme relation (la place devant sert de point d'arrivée). La recherche de la phase 3 devra gérer les chiffres romains, les alias de gares et les lieux décrits par une relation.

## 1. Piazza del Duomo → Darsena (Piazza XXIV Maggio)

Départ : Piazza del Duomo (square, way/463529462) · arrivée : Piazza Ventiquattro Maggio (rue, way/352969044).

Accrochage : départ à 36 m, arrivée à 0 m.

| Niveau | Distance | Écart vs Court | Durée | Pavé | Dalles | Le long de rails | Croisements obliques | À pied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | 1.73 km | – | 7 min | 765 m | 259 m | 137 m | 2 | 0 m |
| 1 Équilibré | 1.79 km | +58 m (+3.4 %) | 7 min | 27 m | 259 m | 0 m | 0 | 0 m |
| 2 Lisse | 1.84 km | +108 m (+6.2 %) | 7 min | 22 m | 204 m | 0 m | 0 | 0 m |
| 3 Zéro pavé | 2.03 km | +300 m (+17.3 %) | 8 min | 0 m | 135 m | 0 m | 0 | 0 m |

## 2. Piazza Castello → Porta Venezia

Départ : Piazza Castello (square, way/728204530) · arrivée : Porta Venezia (attraction, way/27596330).

Accrochage : départ à 2 m, arrivée à 9 m.

| Niveau | Distance | Écart vs Court | Durée | Pavé | Dalles | Le long de rails | Croisements obliques | À pied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | 2.26 km | – | 9 min | 820 m | 147 m | 67 m | 5 | 0 m |
| 1 Équilibré | 2.40 km | +138 m (+6.1 %) | 10 min | 11 m | 191 m | 2 m | 2 | 0 m |
| 2 Lisse | 2.48 km | +214 m (+9.5 %) | 10 min | 0 m | 141 m | 0 m | 1 | 0 m |
| 3 Zéro pavé | 2.59 km | +327 m (+14.4 %) | 10 min | 0 m | 32 m | 0 m | 1 | 0 m |

## 3. Stazione Centrale → Università Bocconi (Via Sarfatti)

Départ : Milano Centrale (gare, node/6067258870) · arrivée : Via Roberto Sarfatti (rue, way/264776940).

Accrochage : départ à 1 m, arrivée à 0 m.

| Niveau | Distance | Écart vs Court | Durée | Pavé | Dalles | Le long de rails | Croisements obliques | À pied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | 4.92 km | – | 20 min | 210 m | 432 m | 0 m | 2 | 0 m |
| 1 Équilibré | 4.93 km | +14 m (+0.3 %) | 20 min | 23 m | 425 m | 0 m | 1 | 0 m |
| 2 Lisse | 5.06 km | +147 m (+3.0 %) | 20 min | 2 m | 187 m | 0 m | 0 | 0 m |
| 3 Zéro pavé | 5.52 km | +599 m (+12.2 %) | 22 min | 2 m | 0 m | 0 m | 0 | 0 m |

## 4. Piazza Medaglie d'Oro → Basilica di Sant'Ambrogio

Départ : Piazzale Medaglie d'Oro (rue, way/36908808) · arrivée : Piazza Sant'Ambrogio (rue, way/359195624).

Accrochage : départ à 0 m, arrivée à 0 m.

| Niveau | Distance | Écart vs Court | Durée | Pavé | Dalles | Le long de rails | Croisements obliques | À pied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | 2.85 km | – | 11 min | 1.49 km | 199 m | 879 m | 7 | 0 m |
| 1 Équilibré | 2.98 km | +133 m (+4.7 %) | 12 min | 40 m | 184 m | 0 m | 0 | 0 m |
| 2 Lisse | 3.01 km | +160 m (+5.6 %) | 12 min | 40 m | 107 m | 0 m | 0 | 0 m |
| 3 Zéro pavé | 3.26 km | +415 m (+14.6 %) | 13 min | 20 m | 100 m | 0 m | 0 | 0 m |

## 5. Stazione Lambrate → Piazza Leonardo da Vinci (témoin)

Départ : Milano Lambrate (gare, node/169701311) · arrivée : Piazza Leonardo da Vinci (park, relation/8066235).

Accrochage : départ à 2 m, arrivée à 15 m.

| Niveau | Distance | Écart vs Court | Durée | Pavé | Dalles | Le long de rails | Croisements obliques | À pied |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | 1.55 km | – | 6 min | 0 m | 52 m | 83 m | 2 | 0 m |
| 1 Équilibré | 1.56 km | +10 m (+0.6 %) | 6 min | 0 m | 52 m | 0 m | 0 | 0 m |
| 2 Lisse | 1.56 km | +10 m (+0.6 %) | 6 min | 0 m | 52 m | 0 m | 0 | 0 m |
| 3 Zéro pavé | 1.56 km | +10 m (+0.6 %) | 6 min | 0 m | 52 m | 0 m | 0 | 0 m |

## Temps de calcul

Requête complète (niveaux 0, 2 et 3, accrochage compris) sur cet ordinateur : 6 ms en moyenne, 20 ms au pire. Budget iPhone : 500 ms.

## Pénalités utilisées

| Niveau | PAVE | SLABS | LOOSE | UNKNOWN | rails ∥ | croisement oblique |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 Court | +0 | +0 | +0 | +0 | +0 | 0 m |
| 1 Équilibré | +1.5 | +0.3 | +0.5 | +0.05 | +1 | 10 m |
| 2 Lisse | +4 | +0.8 | +0.5 | +0.05 | +3 | 25 m |
| 3 Zéro pavé | +30 | +3 | +0.5 | +0.05 | +15 | 60 m |
