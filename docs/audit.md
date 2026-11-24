# Audit des données OSM, Milan

Généré par `pnpm data:audit` le 2026-11-24 14:49 UTC. Ne pas éditer à la main : les commentaires vont dans `docs/audit-notes.md`, inséré ci-dessous.

- Données OSM : état du 2026-11-23 21:21 UTC au 2026-11-24 13:47 UTC, via overpass-api.de (milano-boundary) ; maps.mail.ru (milano-subareas) ; download.geofabrik.de (nord-ovest-latest.osm.pbf) (rails, nodes, highways, addresses).
- Zone téléchargée : bbox de la commune + 1000 m (S 45.3777, O 9.0281, N 45.5448, E 9.2909).
- Statistiques calculées sur deux périmètres : **Comune di Milano** (relation 44915) et **Municipio 1** (relation 3952986). Une longueur est attribuée au périmètre qui contient le milieu de chaque segment.
- 146 401 ways `highway` chargées, dont 106 821 accessibles au vélo selon §6.1 (roulable ou à pied).
- Groupes : **chaussée** = `primary` → `residential`, `living_street`, `unclassified`, `road` ; **service** = `highway=service` ; **voies douces** = `cycleway`, `path`, `track`, `pedestrian`, `footway` retenus. Les places en polygone (`area=yes`) sont exclues des longueurs.

## Lecture et décisions proposées (phase 0)

Rédigé le 2026-11-24 à partir des tableaux ci-dessous. Les décisions marquées **à valider** attendent ta réponse avant la phase 1.

### Verdict proposé : on continue

Les trois raisons d'être du projet (§14) tiennent :

1. **Rails.** 270 km de voies `railway=tram` dans la commune, et aucune way milanaise ne porte `embedded_rails` (§3). Un routeur qui ne lit que les tags de la rue, comme BRouter, ne voit donc aucun rail. La détection spatiale est la seule source, et elle donne un résultat net (§4c, §4d).
2. **Pavé bien renseigné au centre.** Dans le Municipio 1, la chaussée sans `surface` ne pèse que 3,7 %, et le pavé 21,3 %. Sur toute la commune, l'inconnu monte à 14,6 % (255 km), surtout en périphérie, là où le pavé est rare. Le point de rupture du §14 (« part `UNKNOWN` du centre élevée ») n'est pas atteint : pas besoin d'une session de corrections préalable.
3. **Corrections utiles.** OSM est en retard sur les chantiers 2026. Via Torino est encore entièrement en pavé dans OSM : la plupart de ses tronçons ont été modifiés pour la dernière fois le 8 mars 2026, deux jours avant le début des travaux, et une fois le 8 août. La fin du chantier (annoncée en septembre) n'y figure pas.

### Décision 1 : D = 3 m (à valider)

- L'histogramme §4d est bimodal : un pic net entre 1 et 2 m (voie double dessinée de part et d'autre de l'axe de la rue, donc rails dans la chaussée), un creux entre 2,5 et 3,5 m, puis une bosse large de 4 à 9 m.
- Les rues marquées seulement à partir de 4 m sont surtout de grands boulevards où le tram roule probablement en site propre au milieu : Viale Fulvio Testi, Viale Zara, Viale Certosa, Corso XXII Marzo, Via Ripamonti. Avec D = 3 m, elles ne sont pas pénalisées, ce qui est le comportement voulu.
- À vérifier sur la carte (bouton D = 3 puis 6) : Via Rembrandt, Via Tito Livio, Via degli Imbriani, Via Medeghino, Via Faruffini. Si les rails y sont dans la voie de circulation, une correction manuelle suffira.
- Avec D = 3 m : 70 km de chaussée marquée dans la commune, dont 20 km dans le Municipio 1.

### Décision 2 : garder `SLABS` comme classe intermédiaire (à valider)

- `paving_stones` ne couvre que 10,8 km de chaussée dans la commune.
- Dans le centre, les rues en `paving_stones` qui sont du vrai pavé portent déjà `surface_bike=milanese_paving` (Via Cesare Correnti, Via Spadari) et sont donc classées `PAVE`.
- Les 40 plus longues rues restées en `SLABS` (§6) sont surtout des places et rues piétonnes (Piazza del Duomo, Galleria, Via Dante, Alzaia Naviglio Grande) et des rues de quartiers neufs (Via Bruno Cassinari, Via Anna Maria Ortese, Via Carlo Bo).
- Cas douteux à regarder : les rues de Brera classées presque entièrement en `SLABS` (Via Borgonuovo, Via dell'Orso, Via Broletto, Via San Giovanni sul Muro). Si tu sais qu'elles sont en pavé, une correction « Appliquer à toute la rue » réglera chacune.

### Décision 3 : inclure les numéros de rue (à valider)

- 47 575 numéros dans la commune, 37 522 couples rue + numéro distincts.
- 79 % des rues nommées ont au moins un numéro (87 % en longueur), mais la densité est faible : environ 9 numéros par rue en moyenne.
- Proposition : les inclure dans l'index (environ 1 Mo). Si le numéro cherché n'existe pas, prendre le numéro connu le plus proche du même côté (même parité) et l'afficher comme approximatif.

### Décision 4 (nouvelle) : généraliser `surface_bike` (à valider)

La spec ne traite que `surface_bike=milanese_paving`. L'audit montre un schéma local plus riche, sur environ 1 000 ways (55 km) : `milanese_paving` (721), `sett` (199), `milanese_paving:rails` (39), `asphalt` (35), `cobblestone`, `paving_stones`, `milanese_paving:lanes`. Il va souvent de pair avec `cycling_width=narrow/critical`. Sur Corso Magenta, Via Montegani ou Corso di Porta Ticinese, la chaussée est en `asphalt` mais `surface_bike=milanese_paving` : la bande où roule le cycliste, entre voitures garées et rails, reste en pavé.

Proposition :
- quand `surface_bike` existe, il prime sur `surface`, classé avec la même table, et `milanese_paving` et ses variantes (`:rails`, `:lanes`) comptent comme `PAVE` ;
- `surface_bike=milanese_paving:rails` marque aussi l'arête comme ayant des rails sur toute sa longueur (même rôle que `embedded_rails`).

Effet : environ 5 km de chaussée passent en `PAVE` (par exemple `asphalt` + `surface_bike=sett`, 2,1 km).

### Décision 5 (mineure) : valeurs de `surface` non reconnues

Moins de 5 km au total (§8). Proposition : `milanese_paving` et `cobblestone:rounded` → `PAVE` ; `stone` → `PAVE` ; `grass_paver`, `woodchips`, `grass;ground` → `LOOSE` ; `wood`, `metal_grid`, `tiles`, `tartan`, `linoleum` → `SMOOTH`.

### Écarts au brief

- **Source des données.** Les serveurs Overpass publics étaient saturés le 24/11, et un miroir (`overpass.private.coffee`) servait des données figées au 31/05/2026. Les limites administratives viennent d'Overpass ; tout le reste vient de l'extrait Geofabrik Italie Nord-Ouest (données du 23/11/2026, 21:21 UTC), découpé avec `osmium` (`brew install osmium-tool`). `pnpm data:fetch --refresh` télécharge un extrait plus récent ; `--source=overpass` garde l'ancienne voie. Le format des fichiers bruts est identique.
- **Fond de la carte d'audit.** Les tuiles CARTO demandent désormais une clé API : la carte utilise OpenFreeMap (style Positron, sans clé).

### Autres constats

- Corso Magenta et Via Meravigli, annoncés comme « faits », restent mixtes dans OSM (41 % et 34 % d'asphalte). Certains tronçons en `asphalt` + `surface_bike=milanese_paving` datent d'avant les travaux : à confirmer sur place.
- `railway=disused` avec `disused:railway=rail` (25 km, anciens embranchements ferroviaires) compte comme rail présent, comme le prévoit la spec.
- `cycling_width` est renseigné sur environ 900 km (dont 180 km en `narrow` ou `critical`). Hors périmètre (§1), mais c'est une piste de pénalité pour plus tard.

## 1. Revêtements

### 1a. Classes de revêtement par groupe et périmètre

| Groupe | Périmètre | km | SMOOTH | SLABS | PAVE | LOOSE | UNKNOWN |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chaussée | Comune di Milano | 1744.4 | 81.3 % | 0.8 % | 3.2 % | 0.1 % | 14.6 % |
| Chaussée | Municipio 1 | 153.1 | 71.0 % | 4.0 % | 21.3 % | 0.0 % | 3.7 % |
| Service | Comune di Milano | 509.8 | 36.3 % | 2.2 % | 0.9 % | 3.6 % | 57.0 % |
| Service | Municipio 1 | 14.2 | 53.8 % | 4.4 % | 10.7 % | 0.6 % | 30.5 % |
| Voies douces | Comune di Milano | 1368.0 | 39.7 % | 8.3 % | 2.0 % | 13.1 % | 36.8 % |
| Voies douces | Municipio 1 | 111.0 | 27.5 % | 12.9 % | 10.7 % | 24.1 % | 24.8 % |

### 1b. Chaussée : longueur par valeur de `surface`

| Valeur | Classe | km Comune di Milano | % | km Municipio 1 | % |
| --- | --- | ---: | ---: | ---: | ---: |
| `asphalt` | SMOOTH | 1399.5 | 80.2 % | 101.2 | 66.1 % |
| `(aucune)` | UNKNOWN | 254.8 | 14.6 % | 5.5 | 3.6 % |
| `sett + surface_bike=milanese_paving` | PAVE | 17.8 | 1.0 % | 9.6 | 6.3 % |
| `sett` | PAVE | 14.4 | 0.8 % | 6.6 | 4.3 % |
| `concrete:plates` | SMOOTH | 13.2 | 0.8 % | 5.0 | 3.3 % |
| `paving_stones` | SLABS | 10.8 | 0.6 % | 4.2 | 2.7 % |
| `asphalt + surface_bike=milanese_paving` | PAVE | 8.0 | 0.5 % | 3.9 | 2.5 % |
| `paving_stones + surface_bike=milanese_paving` | PAVE | 5.5 | 0.3 % | 4.0 | 2.6 % |
| `sett + surface_bike=sett` | PAVE | 4.6 | 0.3 % | 2.9 | 1.9 % |
| `asphalt + surface_bike=sett` | SMOOTH | 2.1 | 0.1 % | 1.0 | 0.7 % |
| `cobblestone:flattened + surface_bike=milanese_paving` | PAVE | 1.6 | 0.1 % | 1.5 | 1.0 % |
| `paving_stones + surface_bike=milanese_paving:rails` | SLABS | 1.2 | 0.1 % | 1.2 | 0.8 % |
| `concrete` | SMOOTH | 1.1 | 0.1 % | 0.3 | 0.2 % |
| `cobblestone` | PAVE | 1.0 | 0.1 % | 0.4 | 0.3 % |
| `sett + surface_bike=milanese_paving:rails` | PAVE | 0.9 | 0.1 % | 0.9 | 0.6 % |
| `paving_stones + surface_bike=sett` | SLABS | 0.7 | 0.0 % | 0.4 | 0.2 % |
| `asphalt + surface_bike=asphalt` | SMOOTH | 0.7 | 0.0 % | 0.6 | 0.4 % |
| `asphalt + surface_bike=milanese_paving:rails` | SMOOTH | 0.6 | 0.0 % | 0.6 | 0.4 % |
| `compacted` | LOOSE | 0.5 | 0.0 % | 0.0 | 0.0 % |
| `(aucune) + surface_bike=milanese_paving` | PAVE | 0.4 | 0.0 % | 0.3 | 0.2 % |
| `cobblestone:flattened` | PAVE | 0.4 | 0.0 % | 0.4 | 0.3 % |
| `cobblestone + surface_bike=milanese_paving` | PAVE | 0.4 | 0.0 % | 0.3 | 0.2 % |
| `cobblestone + surface_bike=cobblestone` | PAVE | 0.4 | 0.0 % | 0.4 | 0.3 % |
| `unpaved` | LOOSE | 0.4 | 0.0 % | 0.0 | 0.0 % |
| `cobblestone:flattened + surface_bike=milanese_paving:rails` | PAVE | 0.3 | 0.0 % | 0.3 | 0.2 % |
| `paved` | SMOOTH | 0.3 | 0.0 % | 0.0 | 0.0 % |
| `(aucune) + surface_bike=sett` | UNKNOWN | 0.3 | 0.0 % | 0.1 | 0.1 % |
| `unhewn_cobblestone` | PAVE | 0.3 | 0.0 % | 0.3 | 0.2 % |
| `cobblestone + surface_bike=sett` | PAVE | 0.3 | 0.0 % | 0.2 | 0.1 % |
| `cobblestone:flattened + surface_bike=sett` | PAVE | 0.3 | 0.0 % | 0.3 | 0.2 % |
| `unhewn_cobblestone + surface_bike=sett` | PAVE | 0.2 | 0.0 % | 0.2 | 0.1 % |
| `paving_stones + surface_bike=cobblestone` | SLABS | 0.2 | 0.0 % | 0.2 | 0.1 % |
| `concrete:lanes` | SMOOTH | 0.2 | 0.0 % | 0.0 | 0.0 % |
| `ground` | LOOSE | 0.1 | 0.0 % | 0.0 | 0.0 % |
| `sett + surface_bike=paving_stones` | PAVE | 0.1 | 0.0 % | 0.1 | 0.1 % |
| `dirt` | LOOSE | 0.1 | 0.0 % | 0.0 | 0.0 % |
| `concrete:plates + surface_bike=milanese_paving` | PAVE | 0.1 | 0.0 % | 0.0 | 0.0 % |
| `paved + surface_bike=milanese_paving` | PAVE | 0.1 | 0.0 % | 0.0 | 0.0 % |
| `unhewn_cobblestone + surface_bike=milanese_paving:lanes` | PAVE | 0.1 | 0.0 % | 0.1 | 0.0 % |
| `cobblestone:rounded + surface_bike=cobblestone:rounded` | UNKNOWN | 0.1 | 0.0 % | 0.0 | 0.0 % |
| `pebblestone` | LOOSE | 0.1 | 0.0 % | 0.0 | 0.0 % |

Valeurs de moins de 50 m dans les deux périmètres omises (voir §8 pour les valeurs non reconnues). Une `smoothness` `good`/`excellent` sur du pavé est comptée en `SLABS` dans la colonne Classe du tableau 1a, pas ici.

## 2. Part de revêtement inconnu (`UNKNOWN`)

| Groupe | Comune di Milano | Municipio 1 |
| --- | ---: | ---: |
| Chaussée | 14.6 % (255.2 km) | 3.7 % (5.6 km) |
| Service | 57.0 % (290.4 km) | 30.5 % (4.3 km) |
| Voies douces | 36.8 % (504.0 km) | 24.8 % (27.5 km) |

## 3. Effectifs des tags secondaires

Ways du réseau vélo ayant au moins un segment dans Comune di Milano.

### `smoothness`

| Tag | Ways | km |
| --- | ---: | ---: |
| `smoothness=good` | 2902 | 129.2 |
| `smoothness=excellent` | 1521 | 64.4 |
| `smoothness=intermediate` | 773 | 37.4 |
| `smoothness=bad` | 175 | 9.6 |
| `smoothness=very_bad` | 30 | 0.3 |
| `smoothness=horrible` | 1 | 0.2 |

### `surface_bike`

| Tag | Ways | km |
| --- | ---: | ---: |
| `surface_bike=milanese_paving` | 721 | 38.6 |
| `surface_bike=sett` | 199 | 11.1 |
| `surface_bike=milanese_paving:rails` | 39 | 3.1 |
| `surface_bike=asphalt` | 35 | 1.3 |
| `surface_bike=cobblestone` | 8 | 0.8 |
| `surface_bike=paving_stones` | 4 | 0.1 |
| `surface_bike=cobblestone:rounded` | 1 | 0.1 |
| `surface_bike=milanese_paving:lanes` | 1 | 0.1 |

### `embedded_rails`

Aucune occurrence.

### `cycleway:*:surface`

| Tag | Ways | km |
| --- | ---: | ---: |
| `cycleway:surface=asphalt` | 350 | 27.5 |
| `cycleway:surface=paving_stones` | 34 | 3.0 |
| `cycleway:surface=sett` | 11 | 0.8 |
| `cycleway:surface=concrete` | 4 | 0.4 |
| `cycleway:surface=concrete:plates` | 1 | 0.0 |

### `cycling_width` (schéma local, souvent associé à `surface_bike`)

| Tag | Ways | km |
| --- | ---: | ---: |
| `cycling_width=wide` | 4803 | 357.6 |
| `cycling_width=mean` | 3530 | 259.1 |
| `cycling_width=narrow` | 1854 | 142.9 |
| `cycling_width=sufficient` | 952 | 63.1 |
| `cycling_width=good` | 651 | 36.1 |
| `cycling_width=critical` | 621 | 38.9 |
| `cycling_width=sufficient;critical` | 18 | 0.8 |
| `cycling_width=narrow;mean` | 10 | 0.6 |
| `cycling_width=wide;mean` | 5 | 0.6 |
| `cycling_width=mean; wide` | 2 | 0.1 |
| `cycling_width=medium` | 1 | 0.1 |

## 4. Rails de tram

### 4a. Longueur de voies dans Comune di Milano

Chaque voie d'une ligne à double voie est une way distincte : 1 km de ligne ≈ 2 km de voies.

| Type | km de voies |
| --- | ---: |
| railway=tram | 270.4 |
| désaffecté (disused, disused:railway=rail) | 25.4 |
| construction (–) | 23.9 |
| désaffecté (disused, disused:railway=–) | 16.4 |
| désaffecté (disused, disused:railway=tram) | 9.2 |
| construction (tram) | 3.4 |
| désaffecté (disused, disused:railway=funicular) | 0.7 |

### 4b. Tags portés par les rails présents

Pour repérer un tag qui distinguerait rails noyés et site propre (`embedded`, `segregated`, etc.).

| Clé | Ways | Valeurs principales |
| --- | ---: | --- |
| `railway` | 3495 | tram (3151), disused (344) |
| `gauge` | 3253 | 1445 (3117), 1435 (136) |
| `network:wikidata` | 3144 | Q381955 (3144) |
| `electrified` | 3078 | contact_line (3072), rail (3), no (3) |
| `voltage` | 3075 | 600 (3038), 3000 (37) |
| `frequency` | 3074 | 0 (3074) |
| `oneway` | 3020 | yes (3015), no (5) |
| `loc_ref` | 2962 | no (22), 1630_38455 (16), -1 (14), 5150_23232 (7) |
| `service` | 677 | siding (552), yard (119), spur (4), crossover (2) |
| `disused:railway` | 195 | rail (96), tram (96), funicular (3) |
| `tunnel` | 167 | building_passage (103), yes (58), covered (6) |
| `layer` | 109 | 1 (48), -1 (48), 0 (12), -2 (1) |
| `tram` | 76 | yes (76) |
| `lit` | 64 | yes (64) |
| `postal_code` | 42 | 20121 (23), 20124 (14), 20123 (4), 20136 (1) |
| `access` | 33 | no (31), psv (2) |
| `tracks` | 31 | 1 (24), 2 (7) |
| `start_date` | 31 | 2000-12-15 (22), 1999 (3), 2018-09-08 (3), 1965 (2) |
| `bridge` | 26 | yes (21), viaduct (5) |
| `surface` | 22 | cobblestone (19), asphalt (3) |
| `opening_date` | 22 | 2025-10-16 (10), 2026 (8), 2025 (4) |
| `passenger_lines` | 16 | 3 (15), 1 (1) |
| `maxspeed` | 16 | 30 (7), 50 (5), 45 (2), 90 (1) |
| `railway:scmt` | 15 | yes (15) |
| `usage` | 12 | branch (11), industrial (1) |
| `incline` | 8 | down (4), up (4) |
| `covered` | 8 | yes (8) |
| `cutting` | 7 | yes (7) |
| `parking:lane:right` | 6 | no_parking (6) |
| `railway:track_ref` | 5 | 1 Est (1), 1 (1), 2 (1), 4 (1) |

### 4c. Chaussée marquée « sur rails » selon D

Échantillon tous les 10 m sur 104 342 arêtes de chaussée (y compris `service` et `pedestrian`), rail parallèle à ±20°, même `layer`. Arête marquée si `railLen` ≥ 30 m ou ≥ 30 % de sa longueur. Longueurs dans Comune di Milano (milieu d'arête).

| D | Arêtes marquées | km chaussée marquée | dont Municipio 1 | km railLen cumulé | % voies tram à ≤ D d'une chaussée | Rappel sur ways `embedded_rails` | km marqués hors `embedded_rails` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 m | 2 039 | 69.6 | 20.3 | 66.9 | 41.0 % | n/a | 69.6 |
| 4 m | 2 237 | 77.2 | 21.0 | 72.9 | 43.0 % | n/a | 77.2 |
| 5 m | 2 691 | 96.8 | 23.4 | 89.0 | 48.8 % | n/a | 96.8 |
| 6 m | 3 153 | 115.3 | 25.2 | 107.8 | 55.2 % | n/a | 115.3 |

Voies `railway=tram` dans la commune : 270.4 km. Longueur de chaussée portant `embedded_rails` : 0.00 km.

Rues marquées seulement à D ≥ 4 m, à vérifier sur la carte : Viale Fulvio Testi (5250 m), Viale Zara (2457 m), Viale Certosa (2376 m), Corso Ventidue Marzo (2015 m), Viale Monte Nero (1625 m), Via Rembrandt (1358 m), Via Giuseppe Ripamonti (1315 m), Viale Ungheria (1231 m), Viale Piave (1127 m), Viale Corsica (939 m), Via Federico Faruffini (914 m), Via Medeghino (913 m), Via Tito Livio (832 m), Via degli Imbriani (753 m), Via Console Marcello (752 m).

Rues les plus longuement marquées dès D = 3 m : Via Giuseppe Ripamonti (1816 m), Via Lodovico il Moro (1542 m), Viale Carlo Espinasse (1336 m), Via Carlo Farini (1329 m), Corso di Porta Romana (1318 m), Via Vincenzo Monti (1271 m), Via Giulio e Corrado Venini (1208 m), Via Giovanni Battista Grassi (1188 m), Corso Magenta (1091 m), Via Nicola Antonio Porpora (1045 m), Via Giuseppe Meda (1024 m), Via Andrea Solari (966 m), Via delle Forze Armate (934 m), Corso Italia (864 m), Via Luigi Settembrini (855 m).

### 4d. Distribution des distances rail ↔ axe de chaussée

Distance au plus proche rail parallèle, pondérée par la longueur. Colonne 1 : échantillons de chaussée. Colonne 2 : échantillons de voies tram vers la chaussée la plus proche. Un pic net sous 2–3 m signale des rails dessinés dans l'axe de la rue ; une seconde bosse vers 5–9 m signale plutôt des voies en site propre ou des chaussées séparées.

| Distance | km de chaussée | km de voies tram |
| --- | ---: | ---: |
| 0.0–0.5 m | 3.27 | 2.38 |
| 0.5–1.0 m | 8.53 | 6.26 |
| 1.0–1.5 m | 43.22 | 46.65 |
| 1.5–2.0 m | 8.70 | 45.16 |
| 2.0–2.5 m | 1.66 | 7.33 |
| 2.5–3.0 m | 2.24 | 3.00 |
| 3.0–3.5 m | 2.28 | 2.20 |
| 3.5–4.0 m | 3.67 | 3.41 |
| 4.0–4.5 m | 6.76 | 6.29 |
| 4.5–5.0 m | 9.73 | 9.31 |
| 5.0–5.5 m | 9.36 | 8.59 |
| 5.5–6.0 m | 9.53 | 8.83 |
| 6.0–6.5 m | 10.06 | 9.93 |
| 6.5–7.0 m | 11.32 | 11.19 |
| 7.0–7.5 m | 11.59 | 12.28 |
| 7.5–8.0 m | 8.09 | 9.12 |
| 8.0–8.5 m | 6.82 | 6.90 |
| 8.5–9.0 m | 5.12 | 5.64 |
| 9.0–9.5 m | 3.57 | 3.88 |
| 9.5–10.0 m | 2.57 | 3.38 |

Nœuds `railway=tram_level_crossing` / `tram_crossing` dans la zone : 3579.

## 5. Contrôle rue par rue

Chaussées et pistes cyclables portant le nom, dans Comune di Milano (les homonymes des communes voisines sont écartés). « Rails » = longueur effective sur rails des arêtes marquées, pour D = 3 / 4 / 5 / 6 m. Aucune way milanaise ne porte `embedded_rails`.

### Via Torino

Noms OSM : « Via Torino ». Chaussée : 0.73 km, SLABS 8.6 %, PAVE 91.4 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [274985651](https://www.openstreetmap.org/way/274985651) | residential | paving_stones | milanese_paving | – | PAVE | 72 | 72 / 72 / 72 / 72 | 2026-03-08 |
| [168553887](https://www.openstreetmap.org/way/168553887) | residential | sett | milanese_paving | – | PAVE | 43 | 43 / 43 / 43 / 43 | 2024-04-22 |
| [274985649](https://www.openstreetmap.org/way/274985649) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 68 | 68 / 68 / 68 / 68 | 2024-04-22 |
| [274985648](https://www.openstreetmap.org/way/274985648) | residential | sett | milanese_paving | – | PAVE | 91 | 91 / 91 / 91 / 91 | 2025-08-29 |
| [274985650](https://www.openstreetmap.org/way/274985650) | residential | sett | milanese_paving | – | PAVE | 55 | 55 / 55 / 55 / 55 | 2026-03-08 |
| [277620585](https://www.openstreetmap.org/way/277620585) | residential | sett | milanese_paving | – | PAVE | 23 | 23 / 23 / 23 / 23 | 2026-03-08 |
| [277620581](https://www.openstreetmap.org/way/277620581) | residential | sett | milanese_paving | – | PAVE | 21 | 21 / 21 / 21 / 21 | 2026-03-08 |
| [45672229](https://www.openstreetmap.org/way/45672229) | pedestrian | paving_stones | – | – | SLABS | 27 | 0 / 0 / 0 / 0 | 2026-03-08 |
| [277620582](https://www.openstreetmap.org/way/277620582) | residential | sett | milanese_paving | – | PAVE | 53 | 53 / 53 / 53 / 53 | 2026-08-08 |
| [277620586](https://www.openstreetmap.org/way/277620586) | residential | sett | milanese_paving | – | PAVE | 32 | 32 / 32 / 32 / 32 | 2026-03-08 |
| [277620583](https://www.openstreetmap.org/way/277620583) | residential | sett | milanese_paving | – | PAVE | 35 | 35 / 35 / 35 / 35 | 2026-03-08 |
| [277620584](https://www.openstreetmap.org/way/277620584) | residential | sett | milanese_paving | – | PAVE | 80 | 80 / 80 / 80 / 80 | 2026-03-08 |
| [194831663](https://www.openstreetmap.org/way/194831663) | residential | sett | milanese_paving | – | PAVE | 8 | 8 / 8 / 8 / 8 | 2026-03-08 |
| [173512377](https://www.openstreetmap.org/way/173512377) | residential | sett | milanese_paving | – | PAVE | 64 | 64 / 64 / 64 / 64 | 2026-03-03 |
| [251231855](https://www.openstreetmap.org/way/251231855) | residential | paving_stones | – | – | SLABS | 27 | hors réseau vélo | 2024-04-22 |
| [141634886](https://www.openstreetmap.org/way/141634886) | residential | sett | milanese_paving | – | PAVE | 24 | 24 / 24 / 24 / 24 | 2024-04-22 |
| [173512371](https://www.openstreetmap.org/way/173512371) | residential | paving_stones | – | – | SLABS | 9 | 0 / 0 / 0 / 0 | 2026-05-16 |

### Via Cesare Correnti

Noms OSM : « Via Cesare Correnti ». Chaussée : 0.24 km, PAVE 100.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [271008065](https://www.openstreetmap.org/way/271008065) | residential | paving_stones | milanese_paving | – | PAVE | 16 | 16 / 16 / 16 / 16 | 2024-04-22 |
| [298664363](https://www.openstreetmap.org/way/298664363) | residential | paving_stones | milanese_paving | – | PAVE | 165 | 165 / 165 / 165 / 165 | 2024-04-22 |
| [168553861](https://www.openstreetmap.org/way/168553861) | residential | paving_stones | milanese_paving | – | PAVE | 63 | 63 / 63 / 63 / 63 | 2026-01-10 |

### Corso Magenta

Noms OSM : « Corso Magenta ». Chaussée : 1.25 km, SMOOTH 41.1 %, PAVE 58.9 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [168770467](https://www.openstreetmap.org/way/168770467) | residential | sett | milanese_paving:rails | – | PAVE | 54 | hors réseau vélo | 2026-07-16 |
| [25687444](https://www.openstreetmap.org/way/25687444) | residential | asphalt | – | – | SMOOTH | 144 | 144 / 144 / 144 / 144 | 2026-07-16 |
| [369266406](https://www.openstreetmap.org/way/369266406) | residential | asphalt | milanese_paving | – | PAVE | 125 | 125 / 125 / 125 / 125 | 2025-04-01 |
| [168770469](https://www.openstreetmap.org/way/168770469) | residential | sett | milanese_paving | – | PAVE | 23 | 23 / 23 / 23 / 23 | 2026-02-23 |
| [25687511](https://www.openstreetmap.org/way/25687511) | residential | sett | – | – | PAVE | 112 | 112 / 112 / 112 / 112 | 2026-02-23 |
| [286239472](https://www.openstreetmap.org/way/286239472) | residential | asphalt | – | – | SMOOTH | 169 | 169 / 169 / 169 / 169 | 2025-05-10 |
| [286564804](https://www.openstreetmap.org/way/286564804) | residential | asphalt | – | – | SMOOTH | 44 | 44 / 44 / 44 / 44 | 2026-03-27 |
| [289066072](https://www.openstreetmap.org/way/289066072) | residential | asphalt | – | – | SMOOTH | 88 | 14 / 59 / 78 / 78 | 2025-11-10 |
| [164013604](https://www.openstreetmap.org/way/164013604) | residential | asphalt | – | – | SMOOTH | 68 | 68 / 68 / 68 / 68 | 2026-03-27 |
| [286564805](https://www.openstreetmap.org/way/286564805) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 10 | 10 / 10 / 10 / 10 | 2026-02-02 |
| [286242731](https://www.openstreetmap.org/way/286242731) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 21 | 21 / 21 / 21 / 21 | 2026-02-02 |
| [286242732](https://www.openstreetmap.org/way/286242732) | residential | sett | milanese_paving | – | PAVE | 57 | 57 / 57 / 57 / 57 | 2025-12-28 |
| [26702701](https://www.openstreetmap.org/way/26702701) | residential | sett | milanese_paving | – | PAVE | 38 | 19 / 19 / 29 / 29 | 2025-12-28 |
| [284970400](https://www.openstreetmap.org/way/284970400) | residential | sett | milanese_paving | – | PAVE | 18 | 18 / 18 / 18 / 18 | 2025-12-28 |
| [286242733](https://www.openstreetmap.org/way/286242733) | residential | sett | milanese_paving | – | PAVE | 35 | 0 / 0 / 5 / 5 | 2025-12-28 |
| [145018316](https://www.openstreetmap.org/way/145018316) | residential | sett | milanese_paving | – | PAVE | 69 | 69 / 69 / 69 / 69 | 2026-06-02 |
| [273714456](https://www.openstreetmap.org/way/273714456) | residential | sett | milanese_paving | – | PAVE | 68 | 68 / 68 / 68 / 68 | 2025-12-28 |
| [145019295](https://www.openstreetmap.org/way/145019295) | residential | sett | milanese_paving | – | PAVE | 105 | 105 / 105 / 105 / 105 | 2025-12-28 |

### Via Meravigli

Noms OSM : « Via Meravigli ». Chaussée : 0.38 km, SMOOTH 33.6 %, SLABS 35.5 %, PAVE 30.9 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [273455651](https://www.openstreetmap.org/way/273455651) | residential | paving_stones | – | – | SLABS | 23 | 23 / 23 / 23 / 23 | 2026-01-31 |
| [273455650](https://www.openstreetmap.org/way/273455650) | residential | cobblestone | – | – | PAVE | 103 | 103 / 103 / 103 / 103 | 2026-01-31 |
| [273455648](https://www.openstreetmap.org/way/273455648) | residential | asphalt | – | – | SMOOTH | 16 | 16 / 16 / 16 / 16 | 2026-01-31 |
| [165090435](https://www.openstreetmap.org/way/165090435) | residential | asphalt | – | – | SMOOTH | 111 | 111 / 111 / 111 / 111 | 2026-06-02 |
| [273712493](https://www.openstreetmap.org/way/273712493) | residential | paving_stones | – | – | SLABS | 98 | 98 / 98 / 98 / 98 | 2026-06-02 |
| [145018317](https://www.openstreetmap.org/way/145018317) | residential | paving_stones | – | – | SLABS | 13 | 13 / 13 / 13 / 13 | 2026-06-02 |
| [289406968](https://www.openstreetmap.org/way/289406968) | residential | paving_stones | milanese_paving | – | PAVE | 13 | 13 / 13 / 13 / 13 | 2026-11-17 |

### Corso di Porta Romana

Noms OSM : « Corso di Porta Romana ». Chaussée : 1.54 km, SMOOTH 4.0 %, PAVE 96.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [279157050](https://www.openstreetmap.org/way/279157050) | residential | asphalt | – | – | SMOOTH | 33 | 33 / 33 / 33 / 33 | 2025-09-19 |
| [196928982](https://www.openstreetmap.org/way/196928982) | residential | asphalt | – | – | SMOOTH | 29 | 0 / 0 / 0 / 10 | 2025-09-19 |
| [288931912](https://www.openstreetmap.org/way/288931912) | residential | sett | milanese_paving | – | PAVE | 63 | 63 / 63 / 63 / 63 | 2026-05-31 |
| [279157861](https://www.openstreetmap.org/way/279157861) | residential | sett | milanese_paving | – | PAVE | 55 | 55 / 55 / 55 / 55 | 2026-05-31 |
| [279157862](https://www.openstreetmap.org/way/279157862) | residential | sett | milanese_paving | – | PAVE | 86 | 86 / 86 / 86 / 86 | 2026-05-31 |
| [288931910](https://www.openstreetmap.org/way/288931910) | residential | sett | milanese_paving | – | PAVE | 61 | 61 / 61 / 61 / 61 | 2026-01-26 |
| [288931911](https://www.openstreetmap.org/way/288931911) | residential | sett | milanese_paving | – | PAVE | 8 | 8 / 8 / 8 / 8 | 2026-01-26 |
| [289022596](https://www.openstreetmap.org/way/289022596) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 27 | 27 / 27 / 27 / 27 | 2026-08-06 |
| [183874239](https://www.openstreetmap.org/way/183874239) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 63 | 63 / 63 / 63 / 63 | 2023-12-11 |
| [396875175](https://www.openstreetmap.org/way/396875175) | residential | cobblestone:flattened | milanese_paving | – | PAVE | 55 | 9 / 9 / 9 / 46 | 2025-10-12 |
| [396875174](https://www.openstreetmap.org/way/396875174) | residential | sett | milanese_paving | – | PAVE | 70 | 8 / 8 / 53 / 53 | 2025-10-12 |
| [1010751491](https://www.openstreetmap.org/way/1010751491) | residential | sett | milanese_paving | – | PAVE | 12 | 12 / 12 / 12 / 12 | 2026-05-31 |
| [396875173](https://www.openstreetmap.org/way/396875173) | residential | sett | milanese_paving | – | PAVE | 55 | 55 / 55 / 55 / 55 | 2025-07-18 |
| [845489385](https://www.openstreetmap.org/way/845489385) | residential | sett | milanese_paving | – | PAVE | 23 | 0 / 0 / 8 / 8 | 2026-05-31 |
| [183876912](https://www.openstreetmap.org/way/183876912) | residential | sett | milanese_paving | – | PAVE | 4 | 4 / 4 / 4 / 4 | 2026-05-31 |
| [289022597](https://www.openstreetmap.org/way/289022597) | tertiary | sett | milanese_paving | – | PAVE | 174 | 174 / 174 / 174 / 174 | 2026-05-31 |
| [286810145](https://www.openstreetmap.org/way/286810145) | tertiary | sett | milanese_paving | – | PAVE | 40 | 0 / 0 / 0 / 0 | 2026-02-10 |
| [1219522240](https://www.openstreetmap.org/way/1219522240) | tertiary | sett | milanese_paving | intermediate | PAVE | 16 | 0 / 0 / 0 / 0 | 2026-04-18 |
| [183876913](https://www.openstreetmap.org/way/183876913) | tertiary | sett | milanese_paving | – | PAVE | 39 | 39 / 39 / 39 / 39 | 2025-09-06 |
| [1134087071](https://www.openstreetmap.org/way/1134087071) | tertiary | sett | milanese_paving | – | PAVE | 13 | 13 / 13 / 13 / 13 | 2025-09-06 |
| [211261704](https://www.openstreetmap.org/way/211261704) | tertiary | sett | milanese_paving | intermediate | PAVE | 19 | 0 / 0 / 0 / 0 | 2026-04-18 |
| [286603667](https://www.openstreetmap.org/way/286603667) | tertiary | sett | milanese_paving | intermediate | PAVE | 157 | 138 / 138 / 147 / 147 | 2026-04-18 |
| [1211578638](https://www.openstreetmap.org/way/1211578638) | tertiary | sett | milanese_paving | intermediate | PAVE | 65 | 65 / 65 / 65 / 65 | 2026-04-18 |
| [286603665](https://www.openstreetmap.org/way/286603665) | tertiary | sett | milanese_paving | intermediate | PAVE | 156 | 156 / 156 / 156 / 156 | 2026-04-18 |
| [286603664](https://www.openstreetmap.org/way/286603664) | tertiary | sett | milanese_paving | – | PAVE | 61 | 61 / 61 / 61 / 61 | 2025-12-10 |
| [286603666](https://www.openstreetmap.org/way/286603666) | tertiary | sett | milanese_paving | – | PAVE | 56 | 56 / 56 / 56 / 56 | 2025-12-10 |
| [232348206](https://www.openstreetmap.org/way/232348206) | tertiary | sett | milanese_paving | – | PAVE | 101 | 101 / 101 / 101 / 101 | 2026-05-31 |

### Via De Amicis

Noms OSM : « Via Edmondo De Amicis ». Chaussée : 0.81 km, SMOOTH 67.8 %, SLABS 1.8 %, PAVE 24.7 %, UNKNOWN 5.7 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [115346440](https://www.openstreetmap.org/way/115346440) | residential | asphalt | – | – | SMOOTH | 19 | 0 / 0 / 0 / 0 | 2025-12-10 |
| [168553866](https://www.openstreetmap.org/way/168553866) | tertiary | paving_stones | milanese_paving | – | PAVE | 70 | 0 / 0 / 0 / 0 | 2025-12-10 |
| [1216719514](https://www.openstreetmap.org/way/1216719514) | tertiary | paving_stones | milanese_paving | – | PAVE | 21 | 0 / 0 / 0 / 0 | 2026-09-20 |
| [286578753](https://www.openstreetmap.org/way/286578753) | tertiary | paving_stones | milanese_paving | – | PAVE | 111 | 0 / 0 / 0 / 0 | 2026-09-20 |
| [149764466](https://www.openstreetmap.org/way/149764466) | tertiary | asphalt | asphalt | – | SMOOTH | 179 | 0 / 0 / 0 / 0 | 2025-12-10 |
| [997682792](https://www.openstreetmap.org/way/997682792) | tertiary | asphalt | asphalt | – | SMOOTH | 83 | 0 / 0 / 0 / 0 | 2026-01-21 |
| [263800427](https://www.openstreetmap.org/way/263800427) | tertiary | asphalt | asphalt | – | SMOOTH | 18 | 0 / 0 / 0 / 0 | 2026-01-18 |
| [51855669](https://www.openstreetmap.org/way/51855669) | tertiary | asphalt | – | – | SMOOTH | 109 | 0 / 0 / 0 / 0 | 2025-12-10 |
| [263800447](https://www.openstreetmap.org/way/263800447) | tertiary | asphalt | – | – | SMOOTH | 89 | 0 / 0 / 0 / 0 | 2025-11-03 |
| [32263908](https://www.openstreetmap.org/way/32263908) | residential | – | – | – | UNKNOWN | 35 | 0 / 0 / 0 / 0 | 2024-04-22 |
| [281309082](https://www.openstreetmap.org/way/281309082) | residential | – | – | – | UNKNOWN | 11 | 0 / 0 / 0 / 0 | 2024-04-22 |
| [32263849](https://www.openstreetmap.org/way/32263849) | residential | asphalt | – | – | SMOOTH | 23 | 0 / 0 / 0 / 0 | 2026-04-20 |
| [281309086](https://www.openstreetmap.org/way/281309086) | tertiary | asphalt | – | – | SMOOTH | 31 | 0 / 0 / 0 / 0 | 2026-01-21 |
| [281309089](https://www.openstreetmap.org/way/281309089) | tertiary | paving_stones | – | – | SLABS | 15 | 0 / 0 / 0 / 0 | 2025-11-03 |

### Corso di Porta Ticinese

Noms OSM : « Corso di Porta Ticinese ». Chaussée : 0.96 km, SMOOTH 5.7 %, SLABS 13.0 %, PAVE 81.3 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [222858930](https://www.openstreetmap.org/way/222858930) | residential | sett | milanese_paving | – | PAVE | 95 | 0 / 0 / 52 / 71 | 2025-06-09 |
| [255054966](https://www.openstreetmap.org/way/255054966) | residential | cobblestone | milanese_paving | – | PAVE | 95 | hors réseau vélo | 2015-02-05 |
| [143276337](https://www.openstreetmap.org/way/143276337) | residential | sett | milanese_paving | – | PAVE | 23 | 23 / 23 / 23 / 23 | 2026-03-03 |
| [168553834](https://www.openstreetmap.org/way/168553834) | residential | sett | milanese_paving | – | PAVE | 8 | 8 / 8 / 8 / 8 | 2026-03-17 |
| [289515465](https://www.openstreetmap.org/way/289515465) | residential | cobblestone | milanese_paving | – | PAVE | 42 | hors réseau vélo | 2021-11-22 |
| [279159116](https://www.openstreetmap.org/way/279159116) | residential | cobblestone | milanese_paving | – | PAVE | 9 | hors réseau vélo | 2026-06-11 |
| [4857477](https://www.openstreetmap.org/way/4857477) | service | paving_stones | – | – | SLABS | 94 | hors réseau vélo | 2026-06-11 |
| [1190573099](https://www.openstreetmap.org/way/1190573099) | service | paving_stones | – | – | SLABS | 12 | hors réseau vélo | 2026-06-11 |
| [343733719](https://www.openstreetmap.org/way/343733719) | service | paving_stones | – | – | SLABS | 5 | hors réseau vélo | 2026-06-11 |
| [343733716](https://www.openstreetmap.org/way/343733716) | service | paving_stones | – | – | SLABS | 14 | hors réseau vélo | 2026-06-11 |
| [143279607](https://www.openstreetmap.org/way/143279607) | service | sett | – | – | PAVE | 6 | hors réseau vélo | 2026-06-11 |
| [268577817](https://www.openstreetmap.org/way/268577817) | residential | sett | milanese_paving | – | PAVE | 139 | 139 / 139 / 139 / 139 | 2021-06-21 |
| [286590820](https://www.openstreetmap.org/way/286590820) | residential | sett | milanese_paving | – | PAVE | 101 | 101 / 101 / 101 / 101 | 2021-06-21 |
| [88597675](https://www.openstreetmap.org/way/88597675) | service | asphalt | – | – | SMOOTH | 54 | 0 / 0 / 0 / 0 | 2026-04-20 |
| [286590829](https://www.openstreetmap.org/way/286590829) | residential | sett | milanese_paving | – | PAVE | 116 | 116 / 116 / 116 / 116 | 2021-06-21 |
| [286590825](https://www.openstreetmap.org/way/286590825) | residential | sett | milanese_paving | – | PAVE | 94 | 94 / 94 / 94 / 94 | 2022-10-08 |
| [404395780](https://www.openstreetmap.org/way/404395780) | residential | asphalt | milanese_paving | – | PAVE | 10 | 10 / 10 / 10 / 10 | 2021-06-21 |
| [286590801](https://www.openstreetmap.org/way/286590801) | residential | asphalt | milanese_paving | – | PAVE | 24 | 24 / 24 / 24 / 24 | 2021-06-21 |
| [1014320555](https://www.openstreetmap.org/way/1014320555) | pedestrian | paving_stones | milanese_paving | – | PAVE | 9 | 0 / 0 / 0 / 0 | 2026-06-11 |
| [352969033](https://www.openstreetmap.org/way/352969033) | secondary | asphalt | milanese_paving | – | PAVE | 9 | 9 / 9 / 9 / 9 | 2026-03-08 |

### Via Pontaccio

Noms OSM : « Via Pontaccio ». Chaussée : 0.32 km, PAVE 100.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [859293438](https://www.openstreetmap.org/way/859293438) | tertiary | sett | milanese_paving | – | PAVE | 6 | 0 / 0 / 0 / 0 | 2024-03-11 |
| [272535972](https://www.openstreetmap.org/way/272535972) | tertiary | sett | milanese_paving | – | PAVE | 82 | 0 / 0 / 0 / 0 | 2026-11-20 |
| [272651838](https://www.openstreetmap.org/way/272651838) | tertiary | sett | milanese_paving | – | PAVE | 42 | 0 / 0 / 0 / 0 | 2025-08-20 |
| [272651839](https://www.openstreetmap.org/way/272651839) | tertiary | sett | milanese_paving | – | PAVE | 157 | 0 / 0 / 0 / 0 | 2025-11-11 |
| [160615598](https://www.openstreetmap.org/way/160615598) | tertiary | sett | milanese_paving | – | PAVE | 34 | 0 / 0 / 0 / 0 | 2026-05-03 |

### Via Manzoni

Noms OSM : « Via Alessandro Manzoni ». Chaussée : 0.91 km, SMOOTH 1.3 %, SLABS 12.9 %, PAVE 85.8 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [40980379](https://www.openstreetmap.org/way/40980379) | tertiary | asphalt | – | – | SMOOTH | 12 | hors réseau vélo | 2026-04-12 |
| [1413461327](https://www.openstreetmap.org/way/1413461327) | residential | cobblestone | – | – | PAVE | 5 | hors réseau vélo | 2025-11-22 |
| [38001476](https://www.openstreetmap.org/way/38001476) | residential | sett | – | – | PAVE | 18 | 0 / 0 / 0 / 0 | 2026-04-12 |
| [1413461323](https://www.openstreetmap.org/way/1413461323) | residential | cobblestone | – | – | PAVE | 24 | hors réseau vélo | 2025-11-22 |
| [1499648651](https://www.openstreetmap.org/way/1499648651) | residential | sett | – | – | PAVE | 2 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [1413461325](https://www.openstreetmap.org/way/1413461325) | residential | sett | – | – | PAVE | 5 | 0 / 0 / 0 / 0 | 2025-11-22 |
| [40980376](https://www.openstreetmap.org/way/40980376) | residential | sett | – | – | PAVE | 4 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [1131194957](https://www.openstreetmap.org/way/1131194957) | residential | sett | – | – | PAVE | 12 | 0 / 0 / 0 / 0 | 2026-04-12 |
| [1413461320](https://www.openstreetmap.org/way/1413461320) | service | cobblestone | – | – | PAVE | 11 | hors réseau vélo | 2025-12-09 |
| [1499648650](https://www.openstreetmap.org/way/1499648650) | residential | sett | – | – | PAVE | 2 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [40980377](https://www.openstreetmap.org/way/40980377) | residential | sett | – | – | PAVE | 12 | 0 / 0 / 0 / 0 | 2025-07-09 |
| [40980378](https://www.openstreetmap.org/way/40980378) | residential | cobblestone | – | – | PAVE | 5 | hors réseau vélo | 2025-11-22 |
| [183448122](https://www.openstreetmap.org/way/183448122) | residential | sett | – | – | PAVE | 14 | 0 / 0 / 0 / 0 | 2025-11-22 |
| [286270044](https://www.openstreetmap.org/way/286270044) | residential | sett | – | – | PAVE | 11 | 11 / 11 / 11 / 11 | 2026-05-31 |
| [1499648648](https://www.openstreetmap.org/way/1499648648) | residential | sett | – | – | PAVE | 2 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [172821009](https://www.openstreetmap.org/way/172821009) | residential | cobblestone | – | – | PAVE | 20 | hors réseau vélo | 2025-07-09 |
| [183448123](https://www.openstreetmap.org/way/183448123) | residential | sett | – | – | PAVE | 4 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [286276707](https://www.openstreetmap.org/way/286276707) | residential | sett | – | – | PAVE | 5 | 5 / 5 / 5 / 5 | 2026-05-31 |
| [1499648649](https://www.openstreetmap.org/way/1499648649) | residential | sett | – | – | PAVE | 2 | 0 / 0 / 0 / 0 | 2026-04-15 |
| [183448124](https://www.openstreetmap.org/way/183448124) | residential | sett | – | – | PAVE | 25 | 0 / 0 / 0 / 0 | 2025-11-22 |
| [286276706](https://www.openstreetmap.org/way/286276706) | residential | sett | – | – | PAVE | 20 | 20 / 20 / 20 / 20 | 2026-05-31 |
| [226576327](https://www.openstreetmap.org/way/226576327) | residential | sett | – | – | PAVE | 48 | 48 / 48 / 48 / 48 | 2026-03-08 |
| [273375867](https://www.openstreetmap.org/way/273375867) | residential | sett | – | – | PAVE | 116 | 116 / 116 / 116 / 116 | 2025-08-29 |
| [273375864](https://www.openstreetmap.org/way/273375864) | residential | sett | – | bad | PAVE | 23 | 23 / 23 / 23 / 23 | 2026-03-08 |
| [273375866](https://www.openstreetmap.org/way/273375866) | residential | sett | – | – | PAVE | 49 | 0 / 0 / 36 / 36 | 2023-11-22 |
| [273375865](https://www.openstreetmap.org/way/273375865) | residential | sett | – | bad | PAVE | 24 | 0 / 8 / 16 / 16 | 2024-01-03 |
| [172819166](https://www.openstreetmap.org/way/172819166) | residential | sett | – | – | PAVE | 72 | 72 / 72 / 72 / 72 | 2026-03-08 |
| [273367407](https://www.openstreetmap.org/way/273367407) | residential | sett | – | – | PAVE | 42 | 42 / 42 / 42 / 42 | 2023-11-22 |
| [273367400](https://www.openstreetmap.org/way/273367400) | residential | sett | – | – | PAVE | 53 | 53 / 53 / 53 / 53 | 2023-11-22 |
| [273367405](https://www.openstreetmap.org/way/273367405) | residential | sett | – | – | PAVE | 45 | 45 / 45 / 45 / 45 | 2023-11-22 |
| [273367402](https://www.openstreetmap.org/way/273367402) | residential | sett | – | – | PAVE | 84 | 84 / 84 / 84 / 84 | 2026-05-03 |
| [273367398](https://www.openstreetmap.org/way/273367398) | residential | sett | – | – | PAVE | 20 | 20 / 20 / 20 / 20 | 2026-05-03 |
| [145014444](https://www.openstreetmap.org/way/145014444) | residential | paving_stones | – | – | SLABS | 117 | 117 / 117 / 117 / 117 | 2025-11-22 |

### Via Chiossetto

Noms OSM : « Via Chiossetto ». Chaussée : 0.26 km, PAVE 100.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [23227712](https://www.openstreetmap.org/way/23227712) | residential | sett | – | – | PAVE | 201 | 0 / 0 / 0 / 0 | 2026-05-15 |
| [274977559](https://www.openstreetmap.org/way/274977559) | residential | sett | – | – | PAVE | 61 | 0 / 0 / 0 / 0 | 2026-05-15 |

### Via Corridoni

Noms OSM : « Via Filippo Corridoni ». Chaussée : 0.52 km, SMOOTH 52.0 %, PAVE 48.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [1217358589](https://www.openstreetmap.org/way/1217358589) | residential | sett | sett | – | PAVE | 31 | 0 / 0 / 0 / 0 | 2026-05-15 |
| [275480566](https://www.openstreetmap.org/way/275480566) | residential | sett | sett | – | PAVE | 96 | 0 / 0 / 0 / 0 | 2026-05-15 |
| [276479947](https://www.openstreetmap.org/way/276479947) | residential | sett | sett | – | PAVE | 121 | 0 / 0 / 0 / 0 | 2024-04-22 |
| [164070449](https://www.openstreetmap.org/way/164070449) | pedestrian | asphalt | – | – | SMOOTH | 23 | 0 / 0 / 0 / 0 | 2025-05-26 |
| [168773910](https://www.openstreetmap.org/way/168773910) | residential | asphalt | sett | – | SMOOTH | 44 | 0 / 0 / 0 / 0 | 2026-01-20 |
| [33080225](https://www.openstreetmap.org/way/33080225) | pedestrian | asphalt | – | – | SMOOTH | 64 | 0 / 0 / 0 / 0 | 2025-05-26 |
| [276479948](https://www.openstreetmap.org/way/276479948) | residential | asphalt | – | – | SMOOTH | 55 | 0 / 0 / 0 / 0 | 2026-09-22 |
| [168773909](https://www.openstreetmap.org/way/168773909) | residential | asphalt | – | – | SMOOTH | 83 | 0 / 0 / 0 / 0 | 2025-09-06 |

### Via Leoncavallo

Noms OSM : « Via Ruggero Leoncavallo ». Chaussée : 0.57 km, SMOOTH 3.5 %, PAVE 96.5 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [270954153](https://www.openstreetmap.org/way/270954153) | primary | sett | – | – | PAVE | 30 | 30 / 30 / 30 / 30 | 2024-04-23 |
| [270954157](https://www.openstreetmap.org/way/270954157) | primary | sett | – | – | PAVE | 108 | 108 / 108 / 108 / 108 | 2026-07-03 |
| [270568923](https://www.openstreetmap.org/way/270568923) | primary | sett | – | – | PAVE | 62 | 62 / 62 / 62 / 62 | 2026-07-06 |
| [270568922](https://www.openstreetmap.org/way/270568922) | primary | sett | – | – | PAVE | 75 | 75 / 75 / 75 / 75 | 2026-11-08 |
| [270568924](https://www.openstreetmap.org/way/270568924) | primary | sett | – | – | PAVE | 18 | 18 / 18 / 18 / 18 | 2024-04-23 |
| [352971208](https://www.openstreetmap.org/way/352971208) | primary | sett | – | – | PAVE | 29 | 29 / 29 / 29 / 29 | 2026-04-12 |
| [145033219](https://www.openstreetmap.org/way/145033219) | primary | sett | – | – | PAVE | 151 | 151 / 151 / 151 / 151 | 2026-07-26 |
| [270568921](https://www.openstreetmap.org/way/270568921) | primary | sett | – | – | PAVE | 51 | 51 / 51 / 51 / 51 | 2026-07-26 |
| [135664805](https://www.openstreetmap.org/way/135664805) | primary | sett | – | – | PAVE | 23 | 0 / 0 / 0 / 0 | 2026-09-06 |
| [1189105157](https://www.openstreetmap.org/way/1189105157) | primary | asphalt | – | – | SMOOTH | 20 | 0 / 0 / 0 / 0 | 2026-09-06 |

### Via Bramante

Noms OSM : « Via Bramante ». Chaussée : 0.75 km, SMOOTH 100.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [152402393](https://www.openstreetmap.org/way/152402393) | tertiary | asphalt | – | – | SMOOTH | 104 | 104 / 104 / 104 / 104 | 2025-09-19 |
| [267457733](https://www.openstreetmap.org/way/267457733) | tertiary | asphalt | – | – | SMOOTH | 646 | 646 / 646 / 646 / 646 | 2025-05-18 |

### Via Spadari

Noms OSM : « Via Spadari ». Chaussée : 0.13 km, PAVE 100.0 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [1007721410](https://www.openstreetmap.org/way/1007721410) | residential | paving_stones | milanese_paving | intermediate | PAVE | 33 | 33 / 33 / 33 / 33 | 2025-09-26 |
| [277620580](https://www.openstreetmap.org/way/277620580) | residential | paving_stones | milanese_paving | intermediate | PAVE | 88 | 88 / 88 / 88 / 88 | 2025-09-26 |
| [134235719](https://www.openstreetmap.org/way/134235719) | residential | sett | milanese_paving | – | PAVE | 4 | 0 / 0 / 0 / 4 | 2026-03-08 |

### Via Montegani

Noms OSM : « Via Lodovico Montegani ». Chaussée : 0.87 km, SMOOTH 25.2 %, PAVE 74.8 %.

| Way | highway | surface | surface_bike | smoothness | Classe | m | Rails (m) | Modif. OSM |
| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |
| [1180933476](https://www.openstreetmap.org/way/1180933476) | tertiary | asphalt | milanese_paving | – | PAVE | 13 | 13 / 13 / 13 / 13 | 2026-03-31 |
| [1180933484](https://www.openstreetmap.org/way/1180933484) | tertiary | asphalt | milanese_paving | – | PAVE | 11 | 11 / 11 / 11 / 11 | 2026-03-31 |
| [183898604](https://www.openstreetmap.org/way/183898604) | tertiary | asphalt | milanese_paving | – | PAVE | 84 | 84 / 84 / 84 / 84 | 2026-03-31 |
| [1180933483](https://www.openstreetmap.org/way/1180933483) | tertiary_link | asphalt | – | – | SMOOTH | 13 | 0 / 0 / 0 / 0 | 2026-03-31 |
| [273094005](https://www.openstreetmap.org/way/273094005) | tertiary | asphalt | milanese_paving | – | PAVE | 43 | 43 / 43 / 43 / 43 | 2026-03-31 |
| [273094006](https://www.openstreetmap.org/way/273094006) | tertiary_link | asphalt | – | – | SMOOTH | 85 | 0 / 28 / 47 / 85 | 2026-03-31 |
| [273085507](https://www.openstreetmap.org/way/273085507) | tertiary | asphalt | milanese_paving | – | PAVE | 134 | 134 / 134 / 134 / 134 | 2026-03-31 |
| [273085506](https://www.openstreetmap.org/way/273085506) | tertiary | asphalt | milanese_paving | – | PAVE | 112 | 112 / 112 / 112 / 112 | 2023-10-28 |
| [271984059](https://www.openstreetmap.org/way/271984059) | tertiary | asphalt | milanese_paving | – | PAVE | 103 | 103 / 103 / 103 / 103 | 2023-10-29 |
| [268630511](https://www.openstreetmap.org/way/268630511) | tertiary | asphalt | milanese_paving | – | PAVE | 149 | 149 / 149 / 149 / 149 | 2023-10-28 |
| [268630510](https://www.openstreetmap.org/way/268630510) | tertiary | asphalt | – | – | SMOOTH | 120 | 120 / 120 / 120 / 120 | 2026-01-27 |

## 6. Les 40 plus longues rues classées `SLABS`

Chaussées nommées (y compris `service` et `pedestrian`), longueur `SLABS` dans Comune di Milano. Sert à décider si `paving_stones` désigne à Milan des dalles roulantes ou du pavé.

| # | Rue | m SLABS | dont Municipio 1 | % de la rue | Valeurs | highway | smoothness | m PAVE ailleurs sur la rue | Modif. la plus récente |
| ---: | --- | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| 1 | Piazza del Duomo | 820 | 820 | 94.3 % | paving_stones | pedestrian, residential | good, intermediate | 0 | 2026-06-11 |
| 2 | Via Valtellina | 550 | 0 | 29.8 % | paving_stones | secondary, service | – | 12 | 2026-05-16 |
| 3 | Alzaia Naviglio Grande | 513 | 0 | 11.8 % | paving_stones | pedestrian | – | 198 | 2026-09-13 |
| 4 | Via Bruno Cassinari | 458 | 0 | 100.0 % | paving_stones | pedestrian | – | 0 | 2026-03-04 |
| 5 | Via Errico Petrella | 397 | 0 | 100.0 % | paving_stones | residential | – | 0 | 2025-07-14 |
| 6 | Via Conte Rosso | 379 | 0 | 100.0 % | paving_stones | residential | – | 0 | 2025-11-28 |
| 7 | Via Borgonuovo | 379 | 379 | 100.0 % | paving_stones | residential | – | 0 | 2025-11-11 |
| 8 | Via Ettore Majorana | 364 | 0 | 12.4 % | paving_stones | service | – | 0 | 2024-03-20 |
| 9 | Viale Piero e Alberto Pirelli | 343 | 0 | 12.9 % | paving_stones | service | – | 0 | 2023-07-25 |
| 10 | Via Cesare Cesariano | 339 | 339 | 68.5 % | paving_stones | pedestrian | – | 0 | 2025-07-23 |
| 11 | Via Broletto | 336 | 336 | 91.9 % | paving_stones | residential | – | 29 | 2025-11-22 |
| 12 | Via Gian Battista Vico | 329 | 329 | 52.7 % | paving_stones + surface_bike=milanese_paving:rails | residential | – | 0 | 2025-12-26 |
| 13 | Via Anna Maria Ortese | 315 | 0 | 81.9 % | paving_stones | pedestrian | – | 0 | 2022-03-07 |
| 14 | Galleria Vittorio Emanuele Secondo | 311 | 311 | 100.0 % | paving_stones | pedestrian | excellent | 0 | 2026-06-20 |
| 15 | Via Festa del Perdono | 311 | 311 | 58.2 % | paving_stones | pedestrian | – | 217 | 2025-09-15 |
| 16 | Via Gaetano De Castillia | 303 | 0 | 61.0 % | paving_stones | residential | – | 0 | 2025-06-13 |
| 17 | Piazza Quattro Novembre | 290 | 0 | 43.8 % | paving_stones | residential | intermediate | 292 | 2026-05-01 |
| 18 | Via Dino Compagni | 283 | 0 | 100.0 % | sett, paving_stones | pedestrian, unclassified | good, excellent | 0 | 2026-11-03 |
| 19 | Via Carlo Bo | 268 | 0 | 83.2 % | paving_stones | pedestrian | – | 0 | 2023-11-22 |
| 20 | Piazzale Lavater | 260 | 0 | 61.7 % | paving_stones | residential, pedestrian | good | 0 | 2024-03-03 |
| 21 | Via Lazzaro Spallanzani | 235 | 0 | 51.2 % | paving_stones + surface_bike=sett | pedestrian | – | 0 | 2024-05-23 |
| 22 | Piazza Sant'Ambrogio | 232 | 232 | 53.5 % | paving_stones | pedestrian | – | 202 | 2025-12-10 |
| 23 | Piazza Cinque Giornate | 230 | 220 | 31.1 % | asphalt + surface_bike=milanese_paving | secondary | good | 161 | 2025-09-19 |
| 24 | Via Giulio Cesare Procaccini | 230 | 0 | 22.6 % | paving_stones | tertiary | – | 0 | 2023-11-05 |
| 25 | Via degli Olivetani | 227 | 227 | 50.4 % | paving_stones + surface_bike=milanese_paving:rails | residential | – | 0 | 2024-03-05 |
| 26 | Via dell'Orso | 227 | 227 | 100.0 % | paving_stones | residential | – | 0 | 2025-12-09 |
| 27 | Via Carlo Conti | 224 | 0 | 41.3 % | paving_stones | service | – | 17 | 2022-10-10 |
| 28 | Via Luigi Beccali | 217 | 0 | 57.8 % | paving_stones | service | good | 0 | 2022-06-22 |
| 29 | Via San Giovanni sul Muro | 209 | 209 | 95.3 % | paving_stones + surface_bike=milanese_paving:rails | residential | – | 10 | 2026-06-10 |
| 30 | Via Giulio e Corrado Venini | 204 | 0 | 13.0 % | paving_stones | residential | – | 676 | 2025-06-25 |
| 31 | Passeggiata Luigi Veronelli | 200 | 0 | 100.0 % | paving_stones | service | – | 0 | 2026-01-19 |
| 32 | Via Paolo Sarpi | 190 | 89 | 21.5 % | paving_stones | pedestrian | – | 693 | 2025-08-09 |
| 33 | Via Dante | 190 | 190 | 49.1 % | paving_stones + surface_bike=sett | pedestrian | – | 196 | 2026-06-10 |
| 34 | Piazza della Repubblica | 189 | 112 | 5.9 % | paving_stones | tertiary, residential | – | 1028 | 2026-10-09 |
| 35 | Via Gaspare Spontini | 186 | 0 | 100.0 % | paving_stones | residential | intermediate | 0 | 2025-06-21 |
| 36 | Via Anna Castelli Ferrieri | 185 | 0 | 100.0 % | paving_stones | pedestrian | – | 0 | 2022-02-10 |
| 37 | Piazza Santa Francesca Romana | 183 | 0 | 57.2 % | paving_stones | pedestrian | – | 0 | 2026-06-18 |
| 38 | Via Lorenzo Mascheroni | 179 | 179 | 29.5 % | paving_stones + surface_bike=milanese_paving:rails | residential | – | 0 | 2024-04-22 |
| 39 | Via San Cristoforo | 179 | 0 | 56.9 % | paving_stones | residential | – | 0 | 2026-06-08 |
| 40 | Via del Lauro | 173 | 173 | 100.0 % | paving_stones | pedestrian | – | 0 | 2024-09-15 |

Total `SLABS` sur la chaussée de la commune : 13.7 km.

## 7. Adresses

| Mesure | Valeur |
| --- | --- |
| Objets avec `addr:housenumber` | 47 575 (node 47 205, way 370) |
| … avec `addr:street` | 47 563 (100.0 %) |
| … avec `addr:place` seulement | 6 |
| Couples rue + numéro distincts | 37 522 |
| Rues nommées (chaussée) | 4 216 |
| … ayant au moins un numéro | 3 318 (78.7 %) |
| … en longueur | 1636.3 km sur 1879.6 km (87.1 %) |

Plus longues rues nommées sans aucun numéro : Via Ferruccio Parri (5.5 km), Via Lucio Cornelio Silla (4.7 km), Expo Milano 2015 (2.5 km), Via Martirano (2.2 km), Via Benedetto Croce (2.1 km), Collegamento Via Eritrea - Via Stephenson (2.0 km), Viale Federico Caprilli (1.9 km), Piazzale Cimitero Monumentale (1.9 km), Via Aldo Moro (1.8 km), Via Castellammare (1.8 km), Via Guascona (1.6 km), Via Sebastiano Satta (1.5 km), Viale Turchia (1.5 km), Via Toledo (1.5 km), Piazzale dello Sport (1.5 km).

## 8. Valeurs de `surface` non reconnues

Classées `UNKNOWN` en attendant une décision. Réseau vélo entier (tous groupes), dans la commune.

| Valeur | Ways | km | Exemples |
| --- | ---: | ---: | --- |
| `grass_paver` | 47 | 2.72 | [25664929](https://www.openstreetmap.org/way/25664929), [131477040](https://www.openstreetmap.org/way/131477040), [136114621](https://www.openstreetmap.org/way/136114621) |
| `wood` | 18 | 0.96 | [24643749](https://www.openstreetmap.org/way/24643749), [258775003](https://www.openstreetmap.org/way/258775003), [269441871](https://www.openstreetmap.org/way/269441871) |
| `woodchips` | 1 | 0.31 | [1228526538](https://www.openstreetmap.org/way/1228526538) |
| `stone` | 10 | 0.22 | [254552264](https://www.openstreetmap.org/way/254552264), [1039015182](https://www.openstreetmap.org/way/1039015182), [1039015183](https://www.openstreetmap.org/way/1039015183) |
| `grass;ground` | 4 | 0.20 | [208385144](https://www.openstreetmap.org/way/208385144), [912167234](https://www.openstreetmap.org/way/912167234), [912167235](https://www.openstreetmap.org/way/912167235) |
| `tartan` | 1 | 0.19 | [247746046](https://www.openstreetmap.org/way/247746046) |
| `milanese_paving` | 10 | 0.16 | [23227529](https://www.openstreetmap.org/way/23227529), [183864032](https://www.openstreetmap.org/way/183864032), [334484101](https://www.openstreetmap.org/way/334484101) |
| `graound;grass` | 1 | 0.09 | [918607430](https://www.openstreetmap.org/way/918607430) |
| `metal_grid` | 8 | 0.05 | [1141445920](https://www.openstreetmap.org/way/1141445920), [1141445921](https://www.openstreetmap.org/way/1141445921), [1141445923](https://www.openstreetmap.org/way/1141445923) |
| `linoleum` | 2 | 0.05 | [240990540](https://www.openstreetmap.org/way/240990540), [248981600](https://www.openstreetmap.org/way/248981600) |
| `cobblestone:rounded` | 1 | 0.05 | [45445258](https://www.openstreetmap.org/way/45445258) |
| `tiles` | 4 | 0.02 | [1278119121](https://www.openstreetmap.org/way/1278119121), [1498694683](https://www.openstreetmap.org/way/1498694683), [1498694684](https://www.openstreetmap.org/way/1498694684) |
