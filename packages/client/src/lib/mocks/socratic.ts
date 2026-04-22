export interface SocraticQuestion {
  q: string;
  expect: string;
  student: number;
}

export const SOCRATIC_QUESTIONS: SocraticQuestion[] = [
  {
    q: "A plant needs ☀️ sunlight, 💧 water and 🌱 soil. What do you think would happen if we kept a plant inside a dark cupboard for a week?",
    expect: "It would not make food / leaves turn pale / die.",
    student: 0,
  },
  {
    q: "🌼 A sunflower always turns its face toward the sun. Why might that be useful for the plant?",
    expect: "To get more light / to make more food (photosynthesis).",
    student: 1,
  },
  {
    q: "🌧️ After heavy rain, water collects around a plant. Is that always good? Explain your thinking.",
    expect: "Too much water can drown roots / rot them.",
    student: 2,
  },
  {
    q: "🍃 Why do you think leaves are mostly green and not red or blue?",
    expect: "Chlorophyll reflects green light / absorbs other colors.",
    student: 3,
  },
];
