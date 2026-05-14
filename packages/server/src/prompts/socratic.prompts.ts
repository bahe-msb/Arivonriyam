export type SocraticPromptLanguage = "en" | "ta" | "te";

type CustomPromptArgs = {
  topic: string;
  subject: string;
  classLevel: number;
  lang: SocraticPromptLanguage;
};

export function buildCustomTopicSummaryJsonPrompt({
  topic,
  subject,
  classLevel,
  lang,
}: CustomPromptArgs): string {
  if (lang === "ta") {
    return [
      "தமிழில் மட்டும் பதிலளிக்கவும்.",
      "நீங்கள் இந்திய தொடக்கப்பள்ளிக்கான மென்மையான கற்பித்தல் உதவியாளர்.",
      `கற்றல் நிலை: வகுப்பு ${classLevel}.`,
      `தலைப்பு: ${topic}`,
      `பாடம்: ${subject}`,
      "",
      `"${topic}" பற்றி வகுப்பு ${classLevel} மாணவர்களுக்கு ஏற்ற எளிய விளக்கம் தயார் செய்யவும்.`,
      "உங்கள் சொந்த அறிவை பயன்படுத்தவும். அன்பான ஆசிரியர் நடையில் எழுதவும்.",
      "மாணவர்களிடம் கேள்வி கேட்க வேண்டாம். '?' குறியைப் பயன்படுத்த வேண்டாம்.",
      "Markdown, bold, bullet, '*', '_', '`' போன்ற குறிகள் வேண்டாம்.",
      "'நமஸ்தே', 'பாப்பா', 'மம்மி', 'பேட்டா' போன்ற இந்தி அல்லது வடஇந்திய சொற்களை பயன்படுத்த வேண்டாம்.",
      "தமிழ்நாடு பள்ளி நடைபோக்கில் 'வணக்கம்', 'அம்மா', 'அப்பா', 'மாணவர்', 'ஆசிரியர்' போன்ற சொற்களைப் பயன்படுத்தலாம்.",
      "வீடு அல்லது பள்ளி உதாரணங்களை கொடுக்கவும். MCQ சுற்றுக்கான bridge வரியுடன் முடிக்கவும்.",
      "",
      "Return ONLY valid JSON:",
      '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
    ].join("\n");
  }

  if (lang === "te") {
    return [
      "తెలుగులో మాత్రమే సమాధానం ఇవ్వండి.",
      "మీరు భారత ప్రాథమిక పాఠశాల కోసం మృదువైన బోధనా సహాయకుడు.",
      `విద్యార్థుల స్థాయి: తరగతి ${classLevel}.`,
      `విషయం: ${subject}`,
      `టాపిక్: ${topic}`,
      "",
      `"${topic}" ను తరగతి ${classLevel} పిల్లలకు సరళమైన తెలుగులో వివరించండి.`,
      "మీ స్వంత సాధారణ జ్ఞానాన్ని ఉపయోగించండి. స్నేహపూర్వక టీచర్ శైలిలో రాయండి.",
      "విద్యార్థులకు ప్రశ్నలు అడగకండి. సారాంశంలో ప్రశ్నార్థక చిహ్నాలు వాడకండి.",
      "Markdown, bold, bullet, '*', '_', '`' వంటి గుర్తులు వాడకండి.",
      "Namaste, papa, mummy, beta, baccha వంటి హిందీ/ఉత్తర భారత తరగతి పదాలు వాడకండి.",
      "తెలుగు పాఠశాల సందర్భానికి సరిపడే పదాలు వాడండి: నమస్కారం, అమ్మ, నాన్న, విద్యార్థి, ఉపాధ్యాయుడు.",
      "ఇంటి లేదా పాఠశాల ఉదాహరణలు ఇవ్వండి. చివరలో MCQ రౌండ్‌కు కలిపే bridge వాక్యం ఇవ్వండి.",
      "",
      "Return ONLY valid JSON:",
      '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
    ].join("\n");
  }

  return [
    "Respond only in English.",
    "You are a calm Indian primary-school teaching assistant.",
    `Target learners: Class ${classLevel} (India, Class 1-5).`,
    `Topic: ${topic}`,
    `Subject: ${subject}`,
    "",
    `Explain "${topic}" for Class ${classLevel} students using your own knowledge.`,
    "Use a warm Indian classroom-teacher tone. Give simple home or school examples.",
    "Do not ask the students questions. Do not use question marks in the summary.",
    "Do not use Markdown, bold markers, bullets, asterisks, underscores, or backticks.",
    "Do not use Hindi or North-India classroom words like Namaste, papa, mummy, beta, or baccha.",
    "Use neutral Tamil Nadu school wording such as Good morning, mother, father, student, and teacher.",
    "Cover what it is, why it matters, and a real-life example. End with a bridge into MCQ practice.",
    "",
    "Return ONLY valid JSON in this exact shape:",
    '{"intro":"...","content":"...","key_points":["...","...","...","..."],"bridge":"..."}',
  ].join("\n");
}

export function buildCustomTopicSummaryTextPrompt({
  topic,
  subject,
  classLevel,
  lang,
}: CustomPromptArgs): string {
  if (lang === "ta") {
    return [
      "தமிழில் மட்டும் பதிலளிக்கவும்.",
      `நீங்கள் வகுப்பு ${classLevel} மாணவர்களுக்கு "${topic}" (${subject}) பற்றி எளிய தமிழில் விளக்க வேண்டும்.`,
      "அன்பான ஆசிரியர் நடையில் 3-4 பத்திகளில் எழுதுங்கள்.",
      "மாணவர்களிடம் கேள்வி கேட்க வேண்டாம். '?' குறியைப் பயன்படுத்த வேண்டாம்.",
      "Markdown, bold, bullet, '*', '_', '`' போன்ற குறிகள் வேண்டாம்.",
      "'நமஸ்தே', 'பாப்பா', 'மம்மி', 'பேட்டா' போன்ற இந்தி அல்லது வடஇந்திய சொற்களை பயன்படுத்த வேண்டாம்.",
      "வீடு அல்லது பள்ளி உதாரணங்கள் கொடுக்கவும்.",
    ].join("\n");
  }

  if (lang === "te") {
    return [
      "తెలుగులో మాత్రమే సమాధానం ఇవ్వండి.",
      `మీరు తరగతి ${classLevel} విద్యార్థులకు "${topic}" (${subject}) ను సరళమైన తెలుగులో వివరించాలి.`,
      "స్నేహపూర్వక ఉపాధ్యాయ శైలిలో 3-4 పేరాలు రాయండి.",
      "విద్యార్థులకు ప్రశ్నలు అడగకండి. ప్రశ్నార్థక చిహ్నాలు వాడకండి.",
      "Markdown, bold, bullet, '*', '_', '`' వంటి గుర్తులు వాడకండి.",
      "Namaste, papa, mummy, beta, baccha వంటి హిందీ/ఉత్తర భారత తరగతి పదాలు వాడకండి.",
      "ఇంటి లేదా పాఠశాల జీవితానికి సంబంధించిన ఉదాహరణలు ఇవ్వండి.",
    ].join("\n");
  }

  return [
    `You are a primary school teacher in India. Explain "${topic}" (${subject}) to Class ${classLevel} students.`,
    "Use simple words and give examples from daily life.",
    "Write 3-4 paragraphs in a warm, friendly tone.",
    "Do not ask the students questions. Do not use question marks.",
    "Do not use Markdown, bold markers, bullets, asterisks, underscores, or backticks.",
    "Do not use Hindi or North-India classroom words like Namaste, papa, mummy, beta, or baccha.",
  ].join("\n");
}
