# Recette sur iPhone (phase 6)

Appli : https://gunball8.github.io/milano-liscio/

À dérouler sur l'iPhone, de préférence en conditions réelles (à vélo pour le suivi). Noter le modèle et la version d'iOS : le maintien de l'écran allumé demande **iOS 18.4 ou plus**.

| | |
|---|---|
| Date | |
| iPhone / iOS | |

## 1. Installation

- [ ] Ouvrir l'adresse dans **Safari**. L'écran « Installer Milano Liscio » s'affiche avec la marche à suivre.
- [ ] Partager → « Sur l'écran d'accueil ». L'icône (route claire sur pavés) et le nom « Liscio » apparaissent.
- [ ] Lancer depuis l'icône : plus de consigne d'installation, l'offre de téléchargement s'affiche directement.

## 2. Premier téléchargement

- [ ] « Télécharger (39 Mo) » en Wi-Fi : la barre progresse jusqu'au bout, puis la carte s'affiche. Durée notée : ______
- [ ] Menu → Données et sources : « Stockage : persistant ». Sinon, noter ce qui est affiché : ______

## 3. Mode avion

- [ ] Activer le mode avion, fermer complètement l'appli (balayer vers le haut), la relancer depuis l'icône.
- [ ] La carte et ses noms de rues s'affichent, au centre comme en périphérie.
- [ ] Chercher une rue (avec une faute, par exemple « corso magneta ») : résultat trouvé.
- [ ] Les trois alternatives s'affichent avec leurs statistiques.

## 4. Localisation

- [ ] Premier itinéraire depuis « Ma position » : iOS demande l'autorisation à ce moment-là, pas avant.
- [ ] Relancer l'appli le lendemain : iOS redemande-t-il l'autorisation ? Oui / Non : ______

## 5. Carte

- [ ] **Appui long au doigt** sur la carte : le menu « Aller ici / Partir d'ici / Ajouter aux favoris » s'ouvre et reste ouvert après avoir levé le doigt.
- [ ] Ajouter un favori : la pastille ★ apparaît sous la recherche.
- [ ] Passer l'iPhone en mode sombre : la carte et l'interface suivent.
- [ ] Le calcul d'un itinéraire paraît instantané (moins d'une demi-seconde). Sinon, noter : ______

## 6. Suivi GPS (à vélo)

- [ ] « Démarrer » : le bandeau affiche distance restante, heure d'arrivée et prochain tronçon dégradé.
- [ ] La carte suit la position et tourne dans le sens de la marche dès qu'on roule.
- [ ] Message sur l'écran allumé ? Aucun / « refusé » / « ne peut pas » : ______
- [ ] **Écran allumé** : régler Réglages → Luminosité → Verrouillage automatique sur 30 s, rouler 10 minutes sans toucher l'écran. L'écran reste allumé : Oui / Non
- [ ] **Reprise après verrouillage** : verrouiller l'iPhone 1 minute pendant le suivi, déverrouiller. La position reprend, puis l'écran reste allumé.
- [ ] **Changement d'appli** : ouvrir une autre appli 1 minute, revenir. Même chose.
- [ ] Sortir volontairement de l'itinéraire : « Recalcul… », puis un nouvel itinéraire depuis la position.
- [ ] « Signaler » sur un tronçon pavé non signalé : le compteur augmente.
- [ ] À l'arrivée (moins de 25 m) : « Arrivé », avec le nombre de signalements à trier.

## 7. Corrections

- [ ] Menu → Corrections, toucher une rue : la fiche s'ouvre (nom, date OSM, tags).
- [ ] Marquer une rue lisse du trajet en « Pavé », « Terminer » : l'itinéraire change.
- [ ] Liste → À trier : toucher le signalement de l'étape 6, la carte se centre dessus.
- [ ] Exporter la sauvegarde : le menu de partage d'iOS s'ouvre, « Enregistrer dans Fichiers » fonctionne.
- [ ] Importer cette sauvegarde : les corrections reviennent à l'identique.

## 8. Dans une semaine

- [ ] Sans avoir ouvert l'appli pendant 7 jours : favoris, corrections et données toujours là (pas de nouveau téléchargement demandé). Date du contrôle : ______

## 9. Mise à jour des données

Après une nouvelle publication des données (`pnpm data:refresh && pnpm run deploy`) :

- [ ] Menu → Données et sources : une version plus récente est proposée, avec « Mettre à jour ».
- [ ] La mise à jour se termine. L'ancienne version reste utilisable pendant le téléchargement.
- [ ] Liste des corrections : aucune « orpheline » inattendue.

## Remarques

