export const QUOTES = [
  {
    quote: "Tu as le pouvoir sur ton esprit, non sur les événements extérieurs. Prends-en conscience, et tu trouveras la force.",
    author: "Marc Aurèle",
    verse: "Ne vous inquiétez de rien ; mais en toute chose faites connaître vos besoins à Dieu... et la paix de Dieu, qui surpasse toute intelligence, gardera vos cœurs et vos pensées.",
    reference: "Philippiens 4:6-7",
  },
  {
    quote: "Peu importe la vitesse à laquelle tu vas, du moment que tu ne t'arrêtes pas.",
    author: "Confucius",
    verse: "Ne nous lassons pas de faire le bien, car nous moissonnerons au temps convenable, si nous ne relâchons pas.",
    reference: "Galates 6:9",
  },
  {
    quote: "Vis comme si tu devais mourir demain. Apprends comme si tu devais vivre toujours.",
    author: "Gandhi",
    verse: "Enseigne-nous à bien compter nos jours, afin que nous appliquions notre cœur à la sagesse.",
    reference: "Psaume 90:12",
  },
  {
    quote: "On ne voit bien qu'avec le cœur. L'essentiel est invisible pour les yeux.",
    author: "Antoine de Saint-Exupéry",
    verse: "L'Éternel ne regarde pas à ce que l'homme regarde ; l'homme regarde à ce qui frappe les yeux, mais l'Éternel regarde au cœur.",
    reference: "1 Samuel 16:7",
  },
  {
    quote: "Cela semble toujours impossible, jusqu'à ce qu'on le fasse.",
    author: "Nelson Mandela",
    verse: "Je puis tout par celui qui me fortifie.",
    reference: "Philippiens 4:13",
  },
  {
    quote: "Ne laissez jamais personne venir à vous sans repartir meilleur et plus heureux.",
    author: "Mère Teresa",
    verse: "Je vous donne un commandement nouveau : Aimez-vous les uns les autres.",
    reference: "Jean 13:34",
  },
  {
    quote: "Ce n'est pas parce que les choses sont difficiles que nous n'osons pas, c'est parce que nous n'osons pas qu'elles sont difficiles.",
    author: "Sénèque",
    verse: "Fortifie-toi et prends courage, ne t'effraie point et ne t'épouvante point, car l'Éternel, ton Dieu, est avec toi.",
    reference: "Josué 1:9",
  },
  {
    quote: "Avoir un ami, c'est avoir une seconde âme.",
    author: "Victor Hugo",
    verse: "L'ami aime en tout temps, et dans le malheur il se montre un frère.",
    reference: "Proverbes 17:17",
  },
  {
    quote: "La simplicité est la sophistication suprême.",
    author: "Léonard de Vinci",
    verse: "Considérez comment croissent les lis des champs : ils ne travaillent ni ne filent... Salomon même, dans toute sa gloire, n'a pas été vêtu comme l'un d'eux.",
    reference: "Matthieu 6:28-29",
  },
  {
    quote: "Ce qui est derrière nous et ce qui est devant nous ne sont rien comparés à ce qui est en nous.",
    author: "Ralph Waldo Emerson",
    verse: "Notre homme extérieur se détruit, mais notre homme intérieur se renouvelle de jour en jour.",
    reference: "2 Corinthiens 4:16",
  },
  {
    quote: "Nous sommes ce que nous répétons chaque jour. L'excellence n'est donc pas un acte, mais une habitude.",
    author: "Aristote",
    verse: "Confie-toi en l'Éternel de tout ton cœur, et ne t'appuie pas sur ta sagesse... et il aplanira tes sentiers.",
    reference: "Proverbes 3:5-6",
  },
  {
    quote: "Ce n'est pas ce qui nous arrive qui compte, mais la manière dont nous réagissons.",
    author: "Épictète",
    verse: "Nous savons, du reste, que toutes choses concourent au bien de ceux qui aiment Dieu.",
    reference: "Romains 8:28",
  },
  {
    quote: "Le succès, c'est aller d'échec en échec sans perdre son enthousiasme.",
    author: "Winston Churchill",
    verse: "Les bontés de l'Éternel ne sont pas épuisées, ses compassions ne sont pas à leur terme ; elles se renouvellent chaque matin.",
    reference: "Lamentations 3:22-23",
  },
  {
    quote: "Le travail est l'amour rendu visible.",
    author: "Khalil Gibran",
    verse: "Tout ce que vous faites, faites-le de bon cœur, comme pour le Seigneur et non pour des hommes.",
    reference: "Colossiens 3:23",
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
