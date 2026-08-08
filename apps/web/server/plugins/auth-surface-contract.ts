const contract = `<!--
THESIS: Authentication is one legible access register, not a generic centered card.
OWN-WORLD: Mineral white fields, forest actions, rust focus, ruled sections and restrained radii.
STORY: Choose the right account path or validate an invitation, complete one task, and return safely to NeoTamia.
FIRST VIEWPORT: Context and guarantees occupy the left rail; the active form leads on the right.
FORM: Two-zone task register, candidate 4, seed 867fee6a.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html) => {
    html.bodyPrepend.unshift(contract);
  });
});
