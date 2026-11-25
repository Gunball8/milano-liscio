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
