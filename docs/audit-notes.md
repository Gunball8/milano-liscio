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
