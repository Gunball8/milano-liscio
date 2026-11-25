# Audit de l'appli (25 novembre 2026)

Audit de la version en ligne et du code, après les phases 0 à 6 et le design v2. Pour chaque point : le constat, puis ce qui a été fait.

## Qualité des itinéraires

| Constat | Gravité | Fait |
|---|---|---|
| Les barrières des données OSM étaient téléchargées mais ignorées. 625 portails fermés aux vélos se trouvaient sur le réseau : privés (`access=private` ou `no`), verrouillés (`locked=yes`), interdits (`bicycle=no`), ainsi que les tourniquets. Un itinéraire pouvait traverser une cour privée fermée. | haute | Ces nœuds coupent désormais le graphe (`barrierBlocksBikes`, tests unitaires). Les voies qu'on ne pouvait atteindre qu'en passant un tel portail (15 km) sortent du réseau : une destination derrière un portail fermé s'arrête au portail. Bornes, bordures, chicanes et portails ouverts restent franchissables, ainsi que les portails autorisés aux vélos. Un test vérifie, sur 100 itinéraires réels au niveau Court, qu'aucun ne traverse un portail fermé. |
| Les portails publics des parcs ferment souvent la nuit, mais OSM ne le dit presque jamais (`opening_hours`). | info | Rien : non modélisable de façon fiable. |

## Performance et mémoire

Mesures sur Mac (Node), à multiplier par 3 à 5 pour un iPhone récent.

| Mesure | Valeur |
|---|---|
| Démarrage du moteur (graphe, index d'accrochage) | 81 ms |
| Coûts des 4 niveaux | 77 ms |
| Index d'adresses | 16 ms |
| Mémoire du worker | 65 Mo |
| Itinéraire complet (4 niveaux) | 10 ms |
| Calque des revêtements, premier affichage / suivants | 42 / 10 ms |

Constat : le coût du niveau Équilibré n'était pas préparé au démarrage, alors que chaque demande calcule maintenant les 4 niveaux. Fait : les 4 niveaux sont préparés au démarrage du worker.

## Confidentialité

Session complète sur le site réel (premier téléchargement, recherche, itinéraire, écran Corrections) : toutes les requêtes vont vers `gunball8.github.io`. Aucune requête vers un tiers, aucune télémétrie. Favoris, corrections et signalements ne quittent pas le téléphone.

## Robustesse

| Constat | Gravité | Fait |
|---|---|---|
| L'import d'une sauvegarde écrivait les objets du fichier tels quels dans IndexedDB. | moyenne | Chaque enregistrement est vérifié (types, valeurs permises, longueurs). Les invalides sont ignorés et comptés dans le message. Testé avec un fichier mêlant une correction valide et une invalide. |
| Après une nouvelle publication, l'appli installée passait à la nouvelle version sans le dire. Il fallait la relancer deux fois pour la voir. | moyenne | Un bandeau « Nouvelle version de l'appli prête » propose « Recharger ». Il n'apparaît jamais pendant un suivi. |
| Chaque publication remplace tous les fichiers. Une copie encore en cache de l'ancienne page (CDN, onglet ouvert) pouvait chercher des scripts qui n'existent plus. | basse | La publication conserve les fichiers de la version précédente, et seulement d'elle. |
| Le manifeste PWA n'avait pas d'identifiant (`id`). | basse | Ajouté. |

## Bugs d'interface

| Constat | Fait |
|---|---|
| En mode Corrections, toucher un trait fin d'itinéraire changeait le niveau enregistré, sans que rien ne s'affiche. | Les traits ne réagissent plus que sur l'écran Carte. Test ajouté. |
| Un appui long en mode Corrections préparait un menu invisible, qui surgissait au retour sur la carte. | L'appui long n'agit plus que sur l'écran Carte. |
| Après un suivi, le panneau n'affichait plus qu'un niveau sur quatre. | À l'arrivée, l'itinéraire s'efface. En cas d'arrêt en route, les 4 niveaux sont recalculés. |

## Ce qui reste à vérifier sur iPhone

Non testable en navigateur de test : maintien de l'écran allumé, reprise après verrouillage, appui long au doigt sous iOS, flèche orientée par la boussole (permission iOS). Voir `docs/recette-iphone.md`.

## Pistes non retenues

- Découper le code de la carte pour accélérer le tout premier écran : gain d'environ 0,1 s sur iPhone, une seule fois.
- Pénaliser les chicanes (`cycle_barrier`) : peu nombreuses (47 sur le réseau), à reconsidérer si la recette en révèle de gênantes.

---

# Deuxième passe : erreurs et optimisation (25 novembre 2026)

## Erreurs

Parcours complet des fonctions (premier lancement, localisation, recherche et favoris, 4 niveaux, inversion, appui long, suivi avec signalement, Corrections avec export JSON et GeoJSON, réglages, données, passage en thème sombre), en mode développement (avertissements React actifs), sous Chromium et WebKit. Résultat final : **aucune erreur, aucun avertissement**.

| Trouvé | Correction |
|---|---|
| Avertissement « Image townhall could not be loaded » à chaque mairie affichée : le style Protomaps demande une icône qu'aucun jeu d'icônes Protomaps ne fournit, et MapLibre 6 ne résout plus les images manquantes par l'événement utilisé. | Résolveur `setMissingStyleImageResolver` (image vide). |
| « Map cannot fit within canvas » après un suivi : la marge de caméra du suivi s'ajoutait à celle du cadrage de l'itinéraire. | Marge de caméra remise à zéro avant chaque cadrage, marges plafonnées à la hauteur disponible. |
| Lors d'une mise à jour des données, l'ancienne version était supprimée du cache avant que la carte passe sur la nouvelle. Sous iOS, la carte pouvait alors lire un fond déjà effacé (« NotReadableError »). | L'ancienne version n'est supprimée qu'une fois la carte chargée sur la nouvelle. |
| Code inutilisé (2 déclarations). | Retiré ; `noUnusedLocals` et `noUnusedParameters` sont désormais imposés. |

Garde permanente : tous les tests de bout en bout échouent désormais sur une erreur JavaScript ou un avertissement en console, à part les requêtes coupées volontairement en mode avion.

## Optimisation

Mesures sur Mac (Node), mêmes données. Résultats identiques avant et après, vérifiés par des tests d'équivalence sur le vrai graphe (coûts arc par arc, accrochage contre une recherche exhaustive sur 200 points, calque contre un balayage complet sur 50 cadres).

| Poste | Avant | Après |
|---|---:|---:|
| Démarrage complet du moteur (graphe, accrochage, 4 niveaux, adresses) | ~175 ms | ~65 ms |
| Index d'accrochage | 65 ms | 30 ms |
| Coûts des 4 niveaux | 75 ms | 23 ms (un seul passage) |
| Calque des revêtements, premier affichage | 45 ms | 25 ms |
| Calque des revêtements, déplacement de la carte | 5 à 10 ms | 0,7 ms |
| 1 000 accrochages | 13 ms | 4 ms |
| Itinéraire complet (4 niveaux) | 10 ms | 4 à 10 ms |

Fluidité :

- Pendant le suivi, chaque position GPS renvoyait tout l'itinéraire au moteur de rendu de la carte ; désormais seule la position bouge.
- La flèche de position est un marqueur que la carte tourne elle-même : jusqu'à 30 mises à jour par seconde au lieu de 12, sans passer par le moteur de rendu.
- Le moteur démarre en même temps que la lecture des réglages et corrections, au lieu d'après.
- La hauteur des panneaux est observée sans recréer d'observateur à chaque rendu (le bandeau de suivi se redessine à chaque position).

Téléchargement : GitHub compresse déjà les données. Le premier téléchargement fait environ 30 Mo réels pour 39 Mo sur le téléphone ; le fond de carte (21 Mo) est déjà compressé et ne peut pas l'être davantage sans perdre le zoom 15. Le bouton annonce maintenant le poids réel, et la progression s'affiche en pourcentage.

---

# Modèle d'accès piéton (25 novembre 2026)

Demande : plus aucun sens interdit, raisonner comme un piéton pour esquiver le pavé, tout en étant à vélo.

Avant, les règles vélo du cahier des charges s'appliquaient :
- les 2 604 km de trottoirs étaient exclus ;
- les 1 766 km de contresens étaient faits « à pied », chaque mètre comptant 3,5 fois ;
- les 348 km de contresens sur les grands axes étaient interdits ;
- les 1 170 km de voies piétonnes demandaient de descendre du vélo.

Désormais, toute voie ouverte aux piétons ou aux vélos est roulable dans les deux sens, sans pénalité. Restent exclus :
- les voies rapides ;
- les voies interdites à la fois aux piétons et aux vélos (presque toutes les voies interdites aux vélos sont dans ce cas : trémies, bretelles) ;
- les voies privées ;
- les escaliers sans rampe ;
- les portails fermés, tourniquets et chicanes étroites.

Le réglage « Autoriser les passages à pied » disparaît, puisqu'il n'y a plus de passage à pied.

Réseau : 9 443 km, tout dans les deux sens. Graphe : 13,8 → 18,2 Mo. Téléchargement complet : environ 32 Mo au lieu de 30. Démarrage du moteur : 65 → 90 ms sur Mac. Itinéraire complet : 6 à 15 ms.

Effet sur 300 trajets aléatoires de 1,5 à 5 km à vol d'oiseau (centre et proche périphérie) :

| Niveau | Distance moyenne | Pavé moyen | Rails (le long) | Trajets sans aucun pavé |
|---|---|---|---|---|
| Court | 4,14 → 3,89 km (−6 %) | 511 → 454 m | 493 → 412 m | 56 → 47 |
| Équilibré | 4,33 → 3,97 km (−8 %) | 78 → 10 m | 44 → 3 m | 99 → 156 |
| Lisse | 4,46 → 4,00 km (−10 %) | 36 → 5 m | 19 → 1 m | 130 → 199 |
| Zéro pavé | 4,67 → 4,07 km (−13 %) | 14 → 1 m | 10 → 0 m | 199 → 253 |

À noter :
- **Trottoirs** : 72 % sont renseignés en asphalte et 4 % en dalles ou en pavé. Les 23 % sans revêtement indiqué gardent la pénalité « inconnu ».
- **Bordures** : les bordures (`kerb`) restent franchissables ; un trottoir peut donc imposer de monter ou descendre une bordure.
