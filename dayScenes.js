// Index = Date#getDay() (0 = dimanche ... 6 = samedi).
const SCENES = [
  { label: "Dimanche", file: "illustrations/dimanche.png", alt: "Le lapin fait la sieste dans un hamac" },
  { label: "Lundi", file: "illustrations/lundi.png", alt: "Le lapin se réveille, assis sur son lit" },
  { label: "Mardi", file: "illustrations/mardi.png", alt: "Le lapin attablé boit un café" },
  { label: "Mercredi", file: "illustrations/mercredi.png", alt: "Le lapin travaille sur son ordinateur" },
  { label: "Jeudi", file: "illustrations/jeudi.png", alt: "Le lapin coupe des légumes sur une planche" },
  { label: "Vendredi", file: "illustrations/vendredi.png", alt: "Le lapin soulève des poids à la salle de sport" },
  { label: "Samedi", file: "illustrations/samedi.png", alt: "Le lapin peint" },
];

export function sceneForDay(date) {
  return SCENES[date.getDay()];
}
