export const QUOTES = [
  {
    quote: "Quand tu te lèves le matin, songe quel précieux privilège c'est d'être en vie — de respirer, de penser, de jouir de l'existence, d'aimer.",
    author: "Marc Aurèle, Pensées pour moi-même, IIe siècle",
    verse: "C'est ici la journée que l'Éternel a faite : qu'elle soit pour nous un sujet d'allégresse et de joie !",
    reference: "Psaume 118:24",
  },
  {
    quote: "Les pensées sont comme les fleurs, celles qu'on cueille le matin se conservent le plus longtemps fraîches.",
    author: "André Gide (1869-1951)",
    verse: "Fais-moi dès le matin entendre ta bonté ! Car je me confie en toi. Fais-moi connaître le chemin où je dois marcher !",
    reference: "Psaume 143:8",
  },
  {
    quote: "Les heures du matin sont bonnes.",
    author: "attribué à Jeff Bezos",
    verse: "Les bontés de l'Éternel ne sont pas épuisées, ses compassions ne sont pas à leur terme ; elles se renouvellent chaque matin.",
    reference: "Lamentations 3:22-23",
  },
  {
    quote: "Chaque matin, deux choix s'offrent à vous : continuer à dormir avec vos rêves, ou vous lever et les poursuivre.",
    author: "attribué à Carmelo Anthony",
    verse: "Éternel, aie pitié de nous ! Nous espérons en toi. Sois notre aide chaque matin.",
    reference: "Ésaïe 33:2",
  },
  {
    quote: "Confronté à la roche, le ruisseau l'emporte toujours, non pas par la force, mais par la persévérance.",
    author: "Confucius (551-479 av. J.-C.)",
    verse: "La persévérance produit la vertu éprouvée ; la vertu éprouvée produit l'espérance, et l'espérance ne déçoit pas.",
    reference: "Romains 5:4-5",
  },
  {
    quote: "Il n'est pas de vent favorable pour celui qui ne sait où il va.",
    author: "Sénèque (4 av. J.-C. - 65 apr. J.-C.)",
    verse: "Dans toutes tes voies, reconnais-le, et il dirigera tes sentiers.",
    reference: "Proverbes 3:6",
  },
  {
    quote: "Un objectif est un rêve doté d'une échéance.",
    author: "Napoleon Hill (1883-1970)",
    verse: "Je puis tout par celui qui me fortifie.",
    reference: "Philippiens 4:13",
  },
  {
    quote: "Je ne désire que la tranquillité et le repos, qui sont des biens que les plus puissants Rois de la terre ne peuvent donner à ceux qui ne les savent prendre d'eux-mêmes.",
    author: "René Descartes, Correspondance, 15 janvier 1650",
    verse: "C'est dans la tranquillité et le repos que sera votre salut, c'est dans le calme et la confiance que sera votre force.",
    reference: "Ésaïe 30:15",
  },
  {
    quote: "Le repos rend l'esprit plus libre et plus sain pour réfléchir.",
    author: "George Sand (1804-1876)",
    verse: "Il me fait reposer dans de verts pâturages, il me dirige près des eaux paisibles.",
    reference: "Psaume 23:2",
  },
  {
    quote: "Prenez du repos. Un champ que l'on a laissé reposer donne une récolte généreuse.",
    author: "Ovide (43 av. J.-C. - 17/18 apr. J.-C.)",
    verse: "Venez à moi, vous tous qui êtes fatigués et chargés, et je vous donnerai du repos.",
    reference: "Matthieu 11:28",
  },
  {
    quote: "Il faut savoir se prêter au rêve lorsque le rêve se prête à nous.",
    author: "Albert Camus (1913-1960)",
    verse: "Espère en l'Éternel ! Fortifie-toi et que ton cœur s'affermisse ! Espère en l'Éternel !",
    reference: "Psaume 27:14",
  },
  {
    quote: "Tout rêve est réalisation de désir.",
    author: "Sigmund Freud, L'interprétation des rêves, 1900",
    verse: "À celui qui est ferme dans ses sentiments tu assures la paix, la paix, parce qu'il se confie en toi.",
    reference: "Ésaïe 26:3",
  },
  {
    quote: "Marchez sans peur dans la direction de vos rêves.",
    author: "attribué à Henry David Thoreau",
    verse: "Et moi, je chanterai ta force ; dès le matin, je célébrerai ta bonté.",
    reference: "Psaume 59:17",
  },
  {
    quote: "La confiance en soi fait le sot ; la foi en soi fait le grand homme.",
    author: "Victor Hugo (1802-1885)",
    verse: "Je puis tout par celui qui me fortifie.",
    reference: "Philippiens 4:13",
  },
  {
    quote: "On n'est jamais trop vieux pour se fixer un autre objectif ou pour réaliser un nouveau rêve.",
    author: "attribué à C. S. Lewis",
    verse: "Espère en l'Éternel ! Fortifie-toi et que ton cœur s'affermisse ! Espère en l'Éternel !",
    reference: "Psaume 27:14",
  },
  {
    quote: "La gratitude n'est pas seulement la plus grande des vertus, mais aussi la mère de toutes les autres.",
    author: "Cicéron (106-43 av. J.-C.)",
    verse: "Entrez dans ses portes avec des louanges, dans ses parvis avec des cantiques ! Célébrez-le, bénissez son nom !",
    reference: "Psaume 100:4",
  },
  {
    quote: "Notre plus grande faiblesse réside dans notre manque de persévérance. La façon la plus sûre de réussir est d'essayer une fois de plus.",
    author: "Thomas Edison (1847-1931)",
    verse: "Heureux l'homme qui supporte patiemment la tentation ; car, après avoir été éprouvé, il recevra la couronne de vie.",
    reference: "Jacques 1:12",
  },
  {
    quote: "La patience est un arbre dont la racine est amère, et dont les fruits sont très doux.",
    author: "proverbe traditionnel",
    verse: "Heureux l'homme qui supporte patiemment la tentation ; car, après avoir été éprouvé, il recevra la couronne de vie.",
    reference: "Jacques 1:12",
  },
];

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

export function pickQuoteForDate(date, quotes = QUOTES) {
  const index = dayOfYear(date) % quotes.length;
  return quotes[index];
}
