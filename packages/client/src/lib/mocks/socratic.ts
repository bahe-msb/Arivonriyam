export interface RememberCard {
  emoji: string;
  title: string;
  detail: string;
}

export interface SocraticQuestion {
  q: string;
  expect: string;
  student: number;
  rememberTitle: string;
  remember: RememberCard[];
}

export const SOCRATIC_QUESTIONS: SocraticQuestion[] = [
  {
    q: "A plant needs ☀️ sunlight, 💧 water and 🌱 soil. What do you think would happen if we kept a plant inside a dark cupboard for a week?",
    expect: "It would not make food / leaves turn pale / die.",
    student: 0,
    rememberTitle: "What plants need",
    remember: [
      { emoji: "☀️", title: "Sunlight", detail: "Leaves use it to make food." },
      { emoji: "💧", title: "Water", detail: "Roots drink it from the soil." },
      { emoji: "🌱", title: "Soil", detail: "Holds the roots and minerals." },
      { emoji: "🍃", title: "Leaves", detail: "Are green because of chlorophyll." },
    ],
  },
  {
    q: "🌼 A sunflower always turns its face toward the sun. Why might that be useful for the plant?",
    expect: "To get more light / to make more food (photosynthesis).",
    student: 1,
    rememberTitle: "How plants use sunlight",
    remember: [
      { emoji: "☀️", title: "Sunlight", detail: "Powers food-making in leaves." },
      { emoji: "🌻", title: "Heliotropism", detail: "Plants move to follow the light." },
      { emoji: "🍀", title: "Photosynthesis", detail: "Sun + water + CO₂ → food + oxygen." },
      { emoji: "🟢", title: "Chlorophyll", detail: "The green pigment that absorbs light." },
    ],
  },
  {
    q: "🌧️ After heavy rain, water collects around a plant. Is that always good? Explain your thinking.",
    expect: "Too much water can drown roots / rot them.",
    student: 2,
    rememberTitle: "Water and roots",
    remember: [
      { emoji: "💧", title: "Water", detail: "Roots absorb it for the plant." },
      { emoji: "🌱", title: "Roots", detail: "Need both water and air to survive." },
      { emoji: "🪱", title: "Soil drainage", detail: "Good soil lets extra water drain away." },
      { emoji: "⚠️", title: "Too much water", detail: "Can rot roots and block oxygen." },
    ],
  },
  {
    q: "🍃 Why do you think leaves are mostly green and not red or blue?",
    expect: "Chlorophyll reflects green light / absorbs other colors.",
    student: 3,
    rememberTitle: "About leaves",
    remember: [
      { emoji: "🟢", title: "Chlorophyll", detail: "The pigment that makes leaves green." },
      { emoji: "💡", title: "Light absorption", detail: "Leaves absorb red and blue light." },
      { emoji: "🪟", title: "Reflection", detail: "Green light is reflected to our eyes." },
      { emoji: "🍃", title: "Leaf job", detail: "Make food using sunlight and water." },
    ],
  },
];
