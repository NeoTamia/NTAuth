---
name: NTAuth
description: Un registre d’accès sobre pour l’autorité d’identité NeoTamia.
colors:
  forest-ink: "#14201b"
  forest-action: "#1c5941"
  forest-action-hover: "#164733"
  mineral-paper: "#f5f7f3"
  mineral-field: "#eef1ed"
  mineral-border: "#cbd3cc"
  slate-copy: "#45544c"
  rust-focus: "#b84b26"
  rust-marker: "#d77a51"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(2.2rem, 4vw, 4rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.5
rounded:
  control: "0.75rem"
  marker: "50%"
spacing:
  xs: "0.75rem"
  sm: "1rem"
  md: "1.5rem"
  lg: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.forest-action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0.75rem 1rem"
  input-default:
    backgroundColor: "{colors.mineral-field}"
    textColor: "{colors.forest-ink}"
    rounded: "{rounded.control}"
    height: "3.25rem"
---

# Design System: NTAuth

## Overview

**Creative North Star: "Le registre minéral"**

NTAuth ressemble à un registre de contrôle contemporain : fonds minéraux clairs,
encre forestière dense et accents rouille rares. L’interface doit rester calme,
précise et explicite, car elle encadre des actions d’identité et d’autorisation.

Les surfaces opposent contexte et action. Une zone sombre explique la portée ou le
parcours ; une zone claire contient une seule tâche active. La hiérarchie vient de
l’échelle typographique, des aplats et des séparateurs, jamais d’effets décoratifs.

**Key Characteristics:**

- Deux zones lisibles : contexte sombre, action claire.
- Palette forestière et minérale avec un accent rouille fonctionnel.
- Densité modérée, phrases courtes et états explicites.
- Aucun contenu marketing ou décoratif inventé.

## Colors

La palette utilise le vert comme encre et action, le papier minéral comme repos, et
la rouille uniquement pour l’attention, le focus et l’état actif.

### Primary

- **Encre forestière** : texte principal et panneaux de contexte.
- **Action forestière** : boutons primaires ; sa variante profonde signale le survol.

### Tertiary

- **Rouille de contrôle** : anneaux de focus et erreurs.
- **Rouille de repère** : marqueur discret du parcours actif.

### Neutral

- **Papier minéral** : fond général et texte inversé.
- **Champ minéral** : fond des champs de formulaire.
- **Bord minéral** : séparateurs de structure.
- **Copie ardoise** : texte secondaire.

**The Rare Rust Rule.** La rouille indique une attention réelle ; elle ne sert pas
à colorer de grandes surfaces.

## Typography

**Display Font:** pile sans-serif système
**Body Font:** pile sans-serif système

**Character:** une seule famille sobre, avec des titres serrés et massifs face à
un corps plus ouvert. Les changements d’échelle remplacent les ornements.

### Hierarchy

- **Display** (700, fluide, 1) : titres de contexte et de tâche.
- **Body** (400, 1rem, 1.65) : explications, limitées à environ 65 caractères.
- **Label** (700, 0.875rem, 1.5) : champs, liens d’action et états courts.

**The Direct Heading Rule.** Un titre commence directement la section ; aucun
kicker, sourcil ou numéro décoratif ne le précède.

## Layout

Le contenu public est limité à 74rem. Les parcours d’accès utilisent une grille à
deux colonnes asymétriques avec un panneau de contexte sombre et un espace de
travail centré limité à 35rem. À 48rem et moins, la grille devient linéaire, le
contexte se compacte et la navigation reste horizontale lorsque la largeur le
permet. Les contrôles gardent une hauteur minimale tactile de 3.25rem.

## Elevation & Depth

Le système n’utilise aucune ombre. La profondeur vient uniquement des aplats de
couleur, des bordures d’un pixel et du contraste entre le contexte et le papier.

**The Flat Authority Rule.** Une surface d’identité reste plate ; elle ne flotte
pas au-dessus de son contexte.

## Shapes

Les grands panneaux restent rectangulaires et structurants. Les contrôles utilisent
des angles doucement arrondis ; les seuls cercles sont de petits marqueurs d’état.

## Components

### Buttons

- **Shape:** contrôle compact à angles doux.
- **Primary:** fond forestier, texte blanc, graisse forte et largeur complète dans les formulaires.
- **Hover / Focus:** vert plus profond au survol ; anneau rouille de 3px au clavier.
- **Disabled:** fond gris minéral, contraste atténué et curseur interdit.

### Inputs / Fields

- **Style:** fond minéral, bord ardoise d’un pixel et hauteur tactile constante.
- **Focus:** anneau rouille externe, indépendant de la couleur du bord.
- **Error / Disabled:** bord rouille pour l’invalide ; contrôle désactivé pendant la requête.

### Navigation

Les liens sont soulignés dans l’en-tête et structurés par séparateurs dans le
registre. Le parcours actif reçoit un petit marqueur rouille et `aria-current`.

### Registre d’accès

Le composant signature juxtapose le contexte de sécurité et la tâche unique. Sur
mobile, le contexte devient un préambule compact et le premier champ reste proche
du premier écran.

## Do's and Don'ts

### Do:

- **Do** utiliser la zone sombre pour la portée, les contraintes ou les chemins possibles.
- **Do** conserver une seule action primaire par formulaire.
- **Do** annoncer les erreurs, succès et états expirés avec du texte explicite.
- **Do** vérifier clavier, mobile et réduction des animations.

### Don't:

- **Don't** ajouter de gradients, de verre, d’ombres ou de texture simulée.
- **Don't** placer de kicker en capitales au-dessus des titres.
- **Don't** fabriquer de statistiques, témoignages, logos ou promesses commerciales.
- **Don't** utiliser la couleur seule pour communiquer un état.
