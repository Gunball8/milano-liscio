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
