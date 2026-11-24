# SPEC — « Milano Liscio »

Itinéraires vélo qui évitent le pavé et les rails de tram à Milan. Appli web installable sur iPhone, calcul et cartes 100 % sur le téléphone, utilisable sans réseau.

> Brief destiné à Claude Code. Lis tout le fichier avant d'écrire du code. Travaille phase par phase (§11) et arrête-toi à chaque jalon **STOP**.

---

## 0. Règles de travail pour Claude Code

- Échanges et interface en français. Code, identifiants, commits en anglais.
- Ne te fie pas à ta mémoire pour les API de MapLibre GL JS, `pmtiles`, `@protomaps/basemaps`, `vite-plugin-pwa` / Workbox : lis les types du paquet installé ou la doc à jour avant d'écrire l'intégration.
- Une phase = ses critères d'acceptation vérifiés par un test ou une commande reproductible, un commit, puis **STOP** pour validation.
- Aucun backend, aucun compte, aucune télémétrie. À l'exécution, le seul trafic réseau autorisé est le téléchargement des fichiers statiques de l'appli (premier lancement, mise à jour).
- Scripts de données idempotents. Réponses brutes en cache dans `data/raw/` (hors git).
- Si l'audit (phase 0) contredit une hypothèse de ce brief, signale-le et propose une adaptation. Ne contourne pas en silence.
- Aucune adresse personnelle dans le dépôt : les favoris vivent uniquement sur le téléphone.

---

## 1. Objectif et périmètre

**Problème.** À Milan, une partie des rues du centre est en *pavé* (gros blocs de granit, « masselli »), souvent avec des rails de tram noyés dans la chaussée. Les planificateurs grand public ne proposent pas de réglage pour les éviter.

**Produit.** Je choisis un départ et une arrivée, l'appli calcule un trajet vélo qui contourne pavé et rails selon un niveau de tolérance au détour, me montre ce que ça coûte en distance, puis suit ma position pendant que je roule. Quand la carte se trompe, je corrige la rue moi-même.

| Dans le périmètre | Hors périmètre (ne pas construire) |
|---|---|
| iPhone, Safari, appli installée sur l'écran d'accueil | Android, App Store, appli native |
| Zone : Comune di Milano + 1 km de marge | Autres villes, itinéraires hors zone |
| Routage hors-ligne sur l'appareil | Serveur de routage, API tierces |
| Pénalités : pavé, rails de tram | Trafic, dénivelé, préférence pistes cyclables, grands axes |
| Suivi GPS écran allumé, recalcul si écart | Guidage vocal, suivi écran verrouillé |
| Corrections personnelles de revêtement et de rails | Export GPX, envoi automatique vers OSM |

---

## 2. Décisions de cadrage (déjà tranchées)

| Sujet | Décision |
|---|---|
| Téléphone | iPhone uniquement |
| Calcul d'itinéraire | Sur le téléphone, hors-ligne |
| Fonctions | Tracé + suivi GPS en direct + corrections manuelles |
| À pénaliser | Pavé et rails de tram, rien d'autre |
| Forme technique | PWA statique (voir §4 pour la justification) |
| Hébergement | Fichiers statiques en HTTPS, GitHub Pages par défaut |
| Pile | TypeScript partout : Vite + React, MapLibre GL JS, scripts de données en Node (`tsx`) |

---

## 3. Architecture

```
┌──────────────── build (ordinateur) ────────────────┐
│ Overpass ─► data/raw/*.json ─► audit ─► graphe     │
│                               ─► index d'adresses  │
│ Protomaps (pmtiles extract) ─► fond de carte Milan │
│ fonts + sprites Protomaps ─► copiés en local       │
└───────────────► public/data/ + manifest.json ──────┘
                         │ déploiement statique HTTPS
┌──────────────── iPhone (PWA) ──────────────────────┐
│ Service worker : coquille applicative en précache  │
│ Cache Storage : fichiers de données versionnés     │
│ Web Worker : graphe en mémoire, A*, accrochage     │
│ UI React + MapLibre (fond PMTiles lu depuis Blob)  │
│ IndexedDB : favoris, corrections, signalements     │
└────────────────────────────────────────────────────┘
```

Arborescence cible :

```
scripts/        01-fetch-osm.ts  02-audit.ts  03-build-graph.ts
                04-build-geocoder.ts  05-build-basemap.ts  route-cli.ts
src/core/       classify.ts  cost.ts  graph.ts  astar.ts  snap.ts   (partagé build + appli)
src/worker/     router.worker.ts
src/app/        écrans, composants, état (zustand)
src/storage/    idb.ts  dataCache.ts
public/data/    milano-graph.bin  milano-geocoder.bin  milano.pmtiles  manifest.json
public/fonts/   public/sprites/
docs/           audit.md  audit-map.html
```

`src/core` est du TypeScript pur sans DOM : le même code de classification et de coût tourne dans les scripts Node et dans le worker. C'est la raison du choix « TypeScript partout ».

---

## 4. Contraintes iPhone à respecter

1. **HTTPS obligatoire.** Géolocalisation et service worker exigent un contexte sécurisé. `http://192.168.x.x` depuis le téléphone ne marche pas. Donc : hébergement statique HTTPS pour l'usage réel, tunnel HTTPS (`cloudflared`, `tailscale serve`) pour tester en développement.
2. **Installation manuelle.** Pas d'invite d'installation sur iOS : Partager → « Sur l'écran d'accueil ». L'appli doit détecter qu'elle tourne dans Safari (pas en mode standalone) et afficher la marche à suivre.
3. **Installer n'est pas optionnel.** Dans Safari, le stockage d'un site est effaçable après 7 jours sans visite ; les applis web de l'écran d'accueil échappent à ce plafond et disposent du même quota par origine que le navigateur (ordre de grandeur : 60 % du disque). Appeler aussi `navigator.storage.persist()`.
4. **Écran allumé pour le suivi.** Une PWA iOS ne reçoit pas de positions en arrière-plan ni écran verrouillé. Utiliser l'API Screen Wake Lock : elle fonctionne dans les applis web installées à partir d'iOS 18.4 (bug WebKit 254545 corrigé à cette version). Réacquérir le verrou sur `visibilitychange`, gérer le rejet (`NotAllowedError`) et afficher un avertissement si l'API est absente.
5. **UE.** Les applis web d'écran d'accueil restent prises en charge dans l'UE (Apple est revenu sur leur suppression en mars 2024).
6. **Mise en page.** `viewport-fit=cover`, marges `env(safe-area-inset-*)`, pas de `100vh` brut, `apple-touch-icon`, cibles tactiles ≥ 56 px (usage sur guidon), thèmes clair et sombre automatiques.

---

## 5. Données

### 5.1 Sources

| Donnée | Source | Outil |
|---|---|---|
| Rues, revêtements, rails, adresses | OpenStreetMap via Overpass API | `scripts/01-fetch-osm.ts` |
| Fond de carte vectoriel | Build quotidien Protomaps, extrait par bbox | CLI `pmtiles extract` |
| Polices et sprites du fond | Dépôt `protomaps/basemaps-assets` | copie dans `public/` |

Licence : afficher « © OpenStreetMap contributors » (ODbL) et l'attribution Protomaps sur la carte et dans « À propos ».

### 5.2 Téléchargement OSM

Zone : relation administrative du Comune di Milano (`wikidata=Q490`). La requête ci-dessous couvre la commune ; pour la marge de 1 km, interroger plutôt par bbox élargie. Bbox approximative (à recalculer depuis la limite communale) : ouest 9.03, sud 45.38, est 9.29, nord 45.55.

Requête de départ (à ajuster si Overpass la refuse) :

```
[out:json][timeout:300][maxsize:1073741824];
area["wikidata"="Q490"]["boundary"="administrative"]->.milano;
(
  way(area.milano)["highway"];
  way(area.milano)["railway"~"^(tram|disused|construction)$"];
  way(area.milano)["disused:railway"="tram"];
);
out meta geom;
```

- `out meta geom` donne par way : tags, liste des identifiants de nœuds (pour détecter les intersections), géométrie, et `timestamp` de dernière modification (utile pour repérer des tags périmés après travaux).
- Requêtes séparées pour les nœuds utiles (`railway=tram_level_crossing`, `barrier=*`) et pour les adresses (`addr:housenumber` + `addr:street`, sortie `center`).
- La réponse peut dépasser 100 Mo : parser en flux ou découper la zone en quadrants. Une seule requête par jeu de données, délai entre requêtes, `User-Agent` explicite, miroir de secours, cache disque.

### 5.3 Ce qu'on sait déjà de la qualité des tags à Milan

- Le pavé milanais a été étiqueté de façon hétérogène : `sett`, `cobblestone`, `paving_stones` coexistent pour le même revêtement, et la valeur dépréciée `cobblestone:flattened` a été utilisée puis remplacée par `sett` sur certaines rues (exemple : Via Pontaccio, `surface=sett`).
- Une clé non standard `surface_bike=milanese_paving` existe sur au moins une way milanaise. Couverture inconnue.
- Les rails sont cartographiés comme ways `railway=tram` distinctes de la chaussée. Le tag `embedded_rails=tram` sur la rue existe dans le schéma OSM mais sa couverture à Milan est inconnue. Il faut donc une détection spatiale (§6.3).
- La ville retire du pavé en ce moment : Corso Magenta et Via Meravigli sont faits, le chantier Via Torino – Via Cesare Correnti a démarré le 10 mars 2026 avec une fin annoncée en septembre 2026 (environ 65 % du pavé de l'axe remplacé), et d'autres rues sont annoncées (Via De Amicis, Corso di Porta Romana, Via Chiossetto, Via Corridoni, Via Leoncavallo). Le plan vise aussi les rails hors service. Conséquence : OSM peut être en retard dans les deux sens, d'où le rafraîchissement des données (§8) et les corrections manuelles (§9.3).

### 5.4 Fond de carte

```
pmtiles extract https://build.protomaps.com/<AAAAMMJJ>.pmtiles public/data/milano.pmtiles \
  --bbox=9.03,45.38,9.29,45.55 --maxzoom=15
```

- Trouver le build le plus récent sur `maps.protomaps.com/builds` (les builds ne sont conservés qu'environ une semaine : ne pas coder une date en dur).
- Lancer d'abord avec `--dry-run` pour connaître la taille. Budget : 40 Mo. Si dépassé, `--maxzoom=14` (les tuiles vectorielles se sur-zooment correctement).
- Style généré avec `@protomaps/basemaps` (`layers("protomaps", namedFlavor(...), {lang: "it"})`).
- `glyphs` et `sprite` doivent pointer vers des fichiers locaux copiés depuis `basemaps-assets`. Avec les URL par défaut (GitHub Pages de Protomaps), les libellés disparaissent hors-ligne.

---

## 6. Construction du graphe

### 6.1 Accès vélo

| Cas | Traitement |
|---|---|
| `motorway*`, `trunk*` sans `bicycle=yes`, `bicycle=no`, `access=no/private` sans autorisation vélo, `steps`, `construction`, `proposed` | Exclu |
| `primary` → `residential`, `living_street`, `unclassified`, `service`, `cycleway`, `track`, `path`, `pedestrian` (si `bicycle≠no`) | Roulable |
| `footway` avec `bicycle=yes/designated/permissive` | Roulable |
| Autres `footway` (hors `footway=sidewalk`, exclu), `bicycle=dismount` | À pied (vélo poussé) |
| Contresens d'un sens unique sur voie ≤ `tertiary` | À pied, sauf `oneway:bicycle=no` ou `cycleway*=opposite*` → roulable |
| Places piétonnes en polygone (`area=yes`) | Router sur le contour |

Sens uniques : `oneway=yes/1/true`, `-1` (inversé), `junction=roundabout`. Restrictions de tourner ignorées.

### 6.2 Classes de revêtement

| Classe | Valeurs `surface` |
|---|---|
| `SMOOTH` | `asphalt`, `concrete`, `concrete:plates`, `concrete:lanes`, `paved`, `chipseal`, `metal`, `rubber` |
| `SLABS` (ambigu à Milan) | `paving_stones` et variantes, `bricks` |
| `PAVE` | `sett`, `cobblestone`, `cobblestone:flattened`, `unhewn_cobblestone`, ou `surface_bike=milanese_paving` |
| `LOOSE` | `unpaved`, `compacted`, `fine_gravel`, `gravel`, `pebblestone`, `ground`, `dirt`, `earth`, `grass`, `sand`, `mud` |
| `UNKNOWN` | pas de tag `surface` |

Règles :
- **Surface effective par sens.** Si la rue porte une bande ou piste cyclable du côté roulé (circulation à droite : `right` pour le sens de la way, `left` pour le sens inverse, ou `both`) avec son propre tag (`cycleway:right:surface`, `cycleway:both:surface`, `cycleway:surface`), ce tag prime sur `surface`.
- `smoothness=excellent/good` sur un `PAVE` le rétrograde en `SLABS`. Pas d'autre usage de `smoothness`.
- Toute valeur inconnue de `surface` est journalisée par le script, jamais ignorée en silence.

### 6.3 Rails de tram

Rails physiquement présents = `railway=tram`, `railway=disused` et `disused:railway=tram`. `abandoned` est ignoré.

1. Si la rue porte `embedded_rails=tram/yes` : arête marquée, longueur de rails = longueur de l'arête.
2. Sinon, détection spatiale sur les arêtes de chaussée (pas sur `cycleway`/`footway`) : échantillonner l'arête tous les 10 m ; un échantillon est « sur rails » si une way de rails passe à moins de **D** mètres avec un écart de cap ≤ 20°. `railLen` = longueur cumulée des échantillons « sur rails ». Arête marquée si `railLen` ≥ 30 m ou ≥ 30 % de sa longueur.
3. **D est à calibrer en phase 0** (tester 3, 4, 5, 6 m). Le risque : confondre rails noyés dans la voie et tram en site propre au milieu d'un boulevard. Valider sur des rues connues et sur la carte d'audit.
4. Croisements : compter par arête les croisements de rails à angle < 45° (`shallowCrossings`). Les croisements francs ne sont pas pénalisés.

### 6.4 Topologie et format

- Nœud de graphe = extrémité de way ou nœud partagé par ≥ 2 ways retenues. Ne fusionner deux tronçons consécutifs que s'ils ont le même `wayId` : une arête porte un seul jeu d'attributs.
- Arêtes orientées. Par arête : cible, longueur (m), classe de revêtement, `railLen` (m), `shallowCrossings`, mode (roulable / à pied), `wayId` OSM, identifiant de nom de rue, référence vers la géométrie.
- Fichier binaire unique `milano-graph.bin` : en-tête JSON court + tableaux typés (adjacence CSR, coordonnées en `Int32` à 1e-7°). Pas de gros JSON à parser sur le téléphone. Objectifs : chargement < 1 s, taille brute de l'ordre de 10 Mo. Au-delà de 30 Mo, revoir le filtrage et le signaler.
- Index d'adresses `milano-geocoder.bin` : rues (nom normalisé, variantes, point représentatif), numéros par rue si l'audit montre une couverture suffisante, points d'intérêt (gares, stations de métro, universités, places, musées, parcs, hôpitaux).

---

## 7. Modèle de coût et routage

Coût en « mètres équivalents » :

```
cost(e) = L × pushFactor(e)
        + L × surfacePenalty[level][class(e)]
        + railLen(e) × railPenalty[level]
        + shallowCrossings(e) × crossingMeters[level]
```

`pushFactor` = 3,5 pour une arête à pied, 1 sinon. Valeurs de départ, à calibrer en phase 1 :

| Niveau (libellé UI) | `PAVE` | `SLABS` | `LOOSE` | `UNKNOWN` | rails ∥ | croisement oblique |
|---|---|---|---|---|---|---|
| 0 — Court | 0 | 0 | 0 | 0 | 0 | 0 m |
| 1 — Équilibré | +1,5 | +0,3 | +0,5 | +0,05 | +1 | 10 m |
| 2 — Lisse (défaut) | +4 | +0,8 | +0,5 | +0,05 | +3 | 25 m |
| 3 — Zéro pavé | +30 | +3 | +0,5 | +0,05 | +15 | 60 m |

- Pavé et rails s'additionnent sur une même arête (niveau 2 : ×8). Aucune pénalité infinie : une destination située dans une rue pavée reste atteignable.
- Les corrections utilisateur (§9.3) remplacent classe et rails de l'arête avant le calcul du coût.
- **Algorithme :** A* dans un Web Worker, tas binaire, heuristique = distance à vol d'oiseau (admissible puisque tout facteur est ≥ 1). Tableaux de scores réutilisés entre requêtes (tampons horodatés).
- **Accrochage :** grille spatiale sur les géométries d'arêtes ; départ et arrivée projetés sur l'arête roulable la plus proche (≤ 100 m, sinon erreur « hors réseau ») avec nœuds virtuels.
- **Chaque demande lance trois calculs :** niveau 0, niveau choisi, niveau 3. Budget : < 500 ms au total sur iPhone.
- **Résultat par itinéraire :** polyligne, classe par segment, distance, durée (15 km/h roulé, 4,5 km/h à pied, réglable), mètres de `PAVE`, de `SLABS`, le long de rails, nombre de croisements obliques, mètres à pied, écart en mètres et en % avec le niveau 0.

---

## 8. Stockage, hors-ligne, mises à jour

- **Coquille applicative :** précache du service worker (`vite-plugin-pwa`).
- **Données :** ne pas les mettre au précache (Workbox ignore par défaut les fichiers au-delà d'une limite de quelques Mo). L'appli les télécharge elle-même au premier lancement avec barre de progression, vérifie taille et SHA-256 contre `manifest.json`, les range dans un cache nommé `data-<version>`. Le service worker sert `/data/*` en cache d'abord.
- **PMTiles hors-ligne :** lire le fichier en entier depuis le cache sous forme de `Blob` et l'ouvrir via une source fichier de la bibliothèque `pmtiles` (`FileSource`, à confirmer dans les types installés ; sinon implémenter l'interface `Source` avec `blob.slice(offset, offset + length).arrayBuffer()`), puis enregistrer l'instance auprès du `Protocol` passé à `maplibregl.addProtocol`. Pas de requêtes HTTP Range à travers le service worker.
- **IndexedDB (`idb`) :** favoris, récents, corrections, signalements, réglages.
- **Mise à jour :** `manifest.json` porte version, date des données OSM, liste des fichiers. Écran « Données » : version installée, version disponible, bouton « Mettre à jour ». L'ancien cache n'est supprimé qu'après validation complète du nouveau.
- `npm run data:build` reconstruit tout. Rythme conseillé : mensuel tant que les chantiers de pavé continuent.

---

## 9. Application

### 9.1 Écran Carte (accueil)

- Carte plein écran. Barre de recherche : Départ (« Ma position » par défaut) et Arrivée.
- Recherche hors-ligne : insensible à la casse et aux accents, tolère l'absence de « via / viale / corso / piazza », préfixes et fautes légères, forme « rue + numéro », coordonnées collées (`45.4642, 9.19`).
- Appui long sur la carte : « Aller ici » / « Partir d'ici » / « Ajouter aux favoris ».
- Favoris en pastilles, saisis par l'utilisateur et stockés sur l'appareil.
- Sélecteur à 4 crans : Court / Équilibré / Lisse / Zéro pavé.
- Résultat : itinéraire du niveau choisi coloré par segment (lisse = neutre, `SLABS` = orange, `PAVE` = rouge, rails = liseré violet, à pied = pointillé). Les niveaux 0 et 3 en traits fins comparatifs. Panneau bas : distance, durée, « +420 m (+12 %) vs le plus court », mètres de pavé restants, mètres le long de rails, croisements obliques. Toucher une alternative la sélectionne.
- Bouton « Démarrer ».

### 9.2 Écran Suivi

- `watchPosition` haute précision. Carte centrée et orientée selon le cap GPS au-delà de 2 m/s. Wake lock actif.
- Bandeau : distance restante, heure d'arrivée, prochain tronçon dégradé (« pavé dans 120 m, sur 80 m »).
- Hors itinéraire : écart > 35 m sur 3 positions consécutives de précision < 30 m → recalcul depuis la position courante, même niveau. Précision insuffisante : indicateur visible, pas de recalcul.
- Retour au premier plan après verrouillage ou changement d'appli : reprise du suivi et du wake lock.
- Gros bouton **Signaler** : enregistre position, cap et heure dans une liste « à trier ». Aucune saisie en roulant.
- Arrivée à moins de 25 m : fin du suivi.

### 9.3 Écran Corrections

- Calque « Revêtements » activable : `PAVE` rouge, `SLABS` orange, rails violet, `UNKNOWN` gris pointillé. Généré dans l'appli à partir du graphe et des corrections (source GeoJSON).
- Toucher un tronçon ouvre une fiche : nom, tags OSM bruts, date de dernière modification OSM, lien `openstreetmap.org/way/<id>`, état effectif.
- Actions : Revêtement = Lisse / Dalles / Pavé. Rails = Oui / Non. « Appliquer à toute la rue » (tronçons contigus de même nom). « Rétablir OSM ».
- Une correction est prise en compte au calcul suivant, sans rechargement.
- Modèle : `{id, wayId, mid:[lon,lat], length, name, surface?, rails?, note?, source: "manual"|"report", createdAt}`.
- Après mise à jour des données : réassocier chaque correction à l'arête de même `wayId` la plus proche de `mid` (< 25 m), sinon à l'arête de même nom la plus proche. À défaut, la lister comme orpheline. Marquer « obsolète » une correction devenue identique à OSM.
- Liste des corrections et des signalements à trier (toucher un signalement centre la carte dessus en mode correction).
- Export / import JSON (sauvegarde) et export GeoJSON (pour reporter ensuite les corrections dans OSM à la main).

### 9.4 Réglages et premier lancement

- Premier lancement : consigne d'installation si l'appli n'est pas en mode standalone, téléchargement des données, demande de stockage persistant. Permission de localisation demandée au premier usage, pas avant.
- Réglages : vitesse moyenne, autoriser les passages à pied, pénalités avancées (curseurs), état du stockage, version des données, attributions.

---

## 10. Déploiement

- GitHub Pages : `base` Vite, `scope` et `start_url` du manifeste alignés sur le chemin du dépôt. `npm run deploy` publie `dist/`. GitHub refuse les fichiers de plus de 100 Mo : rester en dessous, sinon découper.
- Test sur iPhone en développement : `vite preview` derrière un tunnel HTTPS.
- Le site est public mais ne contient que des données dérivées d'OSM. Favoris et corrections restent sur l'appareil.

---

## 11. Phases et critères d'acceptation

### Phase 0 — Audit des données (go / no-go)

Livrables : `scripts/01-fetch-osm.ts`, `scripts/02-audit.ts`, `docs/audit.md`, `docs/audit-map.html` (page de développement, tuiles en ligne admises ici).

`docs/audit.md` contient :
1. Longueur de chaussée par valeur de `surface` (km et %), pour toute la zone et pour le centre (Municipio 1 si sa limite existe dans OSM, sinon rayon de 2 km autour du Duomo).
2. Part de `UNKNOWN` dans chacun des deux périmètres.
3. Effectifs des tags `smoothness`, `surface_bike`, `embedded_rails`, `cycleway:*:surface`.
4. Rails : km de `railway=tram`, km de chaussée marquée pour D = 3, 4, 5, 6 m, comparaison avec les ways portant `embedded_rails`.
5. Contrôle rue par rue (surface par tronçon, rails, date de dernière modification OSM) : Via Torino, Via Cesare Correnti, Corso Magenta, Via Meravigli, Corso di Porta Romana, Via De Amicis, Corso di Porta Ticinese, Via Pontaccio, Via Manzoni, Via Chiossetto, Via Corridoni, Via Leoncavallo, Via Bramante, Via Spadari, Via Montegani.
6. Les 40 plus longues rues classées `SLABS` (pour décider si `paving_stones` doit être traité comme du pavé à Milan).
7. Adresses : nombre de numéros, part des rues nommées ayant au moins un numéro.
8. Valeurs de `surface` non reconnues.

**STOP.** L'utilisateur parcourt la carte d'audit et confirme : valeur de D, traitement de `SLABS`, numéros de rue dans l'index ou non, poursuite du projet.

### Phase 1 — Graphe et routeur en ligne de commande

- `scripts/03-build-graph.ts`, `src/core/*`, `scripts/route-cli.ts`.
- `npm run route -- "<lat,lon>" "<lat,lon>" --level 2` affiche les statistiques des trois niveaux et écrit un GeoJSON.
- Tests §12 verts. Tableau de calibrage dans `docs/calibration.md` : pour les paires de test, distance et mètres de pavé par niveau.

**STOP.** Validation des pénalités.

### Phase 2 — Coquille PWA et carte hors-ligne

- Fond PMTiles local, polices et sprites locaux, téléchargement des données avec progression, installation sur écran d'accueil.
- Critère : après un premier chargement, mode avion, relance depuis l'icône → carte et libellés s'affichent sur toute la zone.

### Phase 3 — Recherche et itinéraires

- Écran Carte complet (§9.1), worker de routage, index d'adresses.
- Critère : en mode avion, recherche d'une rue puis affichage des trois alternatives et de leurs statistiques.

### Phase 4 — Suivi GPS

- Écran Suivi (§9.2). Tests avec géolocalisation simulée (Playwright WebKit) : progression, sortie d'itinéraire et recalcul, arrivée.

### Phase 5 — Corrections

- Écran Corrections (§9.3). Critère : marquer « Pavé » une rue lisse du trajet change l'itinéraire de niveau 2 au calcul suivant ; export puis import restitue les corrections à l'identique.

### Phase 6 — Déploiement et recette sur iPhone

Liste de recette à faire dérouler par l'utilisateur : installation, premier téléchargement, mode avion, permission de localisation (noter si iOS la redemande à chaque session), écran qui reste allumé pendant 10 min de suivi, reprise après verrouillage, persistance des corrections après une semaine, mise à jour des données.

---

## 12. Tests

Unitaires (Vitest) :
- Classification : table de cas tags → classe, surface effective par sens, sens uniques et contresens cyclables.
- Coût : valeurs attendues par niveau, application des corrections.
- A* : coût identique à Dijkstra sur 200 paires aléatoires (vérifie l'admissibilité de l'heuristique).
- Invariants sur 200 paires aléatoires : distance(niveau 3) ≥ distance(niveau 0) ; mètres de pavé(niveau 3) ≤ mètres de pavé(niveau 0) ; aucun sens interdit emprunté en mode roulable.

Paires de référence (géocodées par l'index du projet, pas de coordonnées en dur) :
1. Piazza del Duomo → Darsena (Piazza XXIV Maggio).
2. Piazza Castello → Porta Venezia.
3. Stazione Centrale → Università Bocconi (Via Sarfatti).
4. Piazza Medaglie d'Oro → Basilica di Sant'Ambrogio.
5. Stazione Lambrate → Piazza Leonardo da Vinci (témoin : peu ou pas de pavé attendu, donc niveaux 0 et 3 quasi identiques ; si ce n'est pas le cas, expliquer pourquoi).

Bout en bout (Playwright, WebKit, viewport iPhone) : parcours de la phase 3, suivi simulé de la phase 4, hors-ligne de la phase 2.

---

## 13. Pièges connus

1. Géolocalisation et service worker muets en HTTP sur IP locale.
2. Fichiers de données absents du précache si on compte sur la configuration Workbox par défaut.
3. Libellés de carte absents hors-ligne si `glyphs` / `sprite` pointent vers Internet.
4. Requêtes Range sur un fichier en cache : éviter, lire le PMTiles comme `Blob`.
5. Wake lock relâché à chaque passage en arrière-plan : le redemander.
6. Coordonnées en `Float32` : précision insuffisante, utiliser `Int32` à 1e-7°.
7. Identifiants de nœuds OSM au-delà de 2^32 : ne pas les stocker dans le graphe, ou en `Float64` / `BigInt` côté build uniquement.
8. Fusion d'arêtes à travers un changement de tags : interdit (§6.4).
9. Overpass : délais et quotas. Toujours travailler depuis `data/raw/` une fois les données récupérées.
10. Tram en site propre confondu avec rails dans la voie : c'est le principal risque de faux positifs, à traiter par le calibrage de D et par les corrections.

---

## 14. Arbitrages et points de rupture

| Choix retenu | Contre-argument | Point de rupture |
|---|---|---|
| Construire une appli | Un profil BRouter personnalisé sait déjà pénaliser `surface=sett/cobblestone` et s'utilise en quelques minutes dans BRouter-web. | Si l'audit montre que rails et corrections apportent peu, ou si un usage en ligne suffit : abandonner le développement et écrire un profil BRouter. Le projet se justifie par trois choses réunies : hors-ligne sur iPhone, rails (invisibles pour un routeur qui ne lit que les tags de la rue), corrections personnelles. |
| PWA | Pas de suivi écran verrouillé, pas de guidage vocal fiable. | Besoin du téléphone dans la poche avec instructions audio : passer en natif (compte développeur Apple payant, sinon signature à renouveler tous les 7 jours). |
| Routage sur l'appareil | Un serveur gère mieux les grandes zones et les mises à jour. | Extension à plusieurs villes ou à la région. |
| OSM comme vérité de base | Tags hétérogènes, en retard sur les chantiers 2026. | Si la part `UNKNOWN` du centre est élevée à l'audit : prévoir une session de corrections initiale, ou corriger OSM à la source (iD) avant de construire. |
| Hébergement statique public | « En local » au sens strict voudrait zéro hébergement. | Impossible sur iPhone sans HTTPS. Le calcul et les données personnelles restent sur l'appareil ; seul le code et les données OSM sont servis. |

---

## 15. Sources

- OSM wiki, `embedded_rails` : https://wiki.openstreetmap.org/wiki/Key:embedded_rails
- OSM wiki, `railway=tram` : https://wiki.openstreetmap.org/wiki/Tag:railway=tram
- Liste talk-it, « Definizione definitiva del pavé milanese » (2012) : https://lists.openstreetmap.org/pipermail/talk-it/2012-June/029285.html
- Via Pontaccio, `surface=sett` : https://www.openstreetmap.org/way/160615598
- Exemple `surface_bike=milanese_paving` : https://www.openstreetmap.org/way/173087874
- Wake Lock dans les applis web installées (corrigé en iOS 18.4) : https://bugs.webkit.org/show_bug.cgi?id=254545 et https://progressier.com/pwa-capabilities/screen-wake-lock
- Quotas de stockage WebKit : https://webkit.org/?p=14403 et https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Plafond de 7 jours non appliqué aux applis d'écran d'accueil : https://developer.apple.com/forums/thread/710157
- Applis web d'écran d'accueil maintenues dans l'UE : https://www.macrumors.com/2024/03/01/apple-walks-back-decision-to-disable-eu-web-apps/
- Protomaps, extraction : https://docs.protomaps.com/guide/getting-started
- Protomaps, polices et sprites : https://docs.protomaps.com/basemaps/maplibre
- PMTiles et MapLibre : https://docs.protomaps.com/pmtiles/maplibre
- Chantier Via Torino (mars 2026) : https://www.ilgiorno.it/milano/cronaca/via-torino-rimozione-pave-etj3pj3t et https://www.open.online/2026/03/10/milano-rimozione-pave-via-torino-cesare-correnti-lavori-video/
- Autres rues annoncées : https://www.ilgiorno.it/milano/cronaca/sala-dice-no-al-pave-13cb8f19
- BRouter, profils configurables : https://brouter.de/brouter/costfunctions.html
