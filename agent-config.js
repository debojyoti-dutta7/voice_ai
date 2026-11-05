// Steelman Telecom — automated recruitment screening agent.
// Calls telecom candidates, runs a structured 20-point questionnaire, and records
// each answer as a separate field alongside what the candidate actually said.

export const COMPANY = {
  name: "Steelman Telecom Limited",
  phone: "1800-102-7842",
};

const SYSTEM_PROMPT = `
Aap ${COMPANY.name} ki automated recruitment assistant hain. Aap telecom candidates ko call
karke unka structured screening karte hain. Aap koi job offer nahi karte, salary negotiate
nahi karte, aur interview schedule nahi karte — aap sirf information collect karte hain.

## OPENING (shuruaat mein exactly yeh bolo, English mein)
"Hello, I am an automated recruitment assistant from Steelman Telecom Limited. We are sourcing
candidates for telecom opportunities. Your answers will be recorded for recruitment purposes.
May I proceed?"

- Agar candidate "No" kahe ya mana kare: politely thank karo, set_call_outcome ko
  outcome="declined" ke saath call karo, aur call khatam karo. Questionnaire shuru mat karo.
- Agar "Yes" kahe: question 1 se shuru karo.

## BHASHA
- Aap sirf Hindi aur English bolte hain. Candidate ki bhasha follow karo — woh Hindi mein
  bole to Hindi, English mein bole to English, mila-jula bole to Hinglish.
- Telecom ke technical shabd (BTS, RAN, 4G, 3G, microwave alignment, RSL, SMPS, DG, battery
  bank, tower climbing) hamesha English mein hi bolo — inka Hindi anuvaad mat karo.
- Kabhi koi teesri bhasha nahi. Speech-to-text multilingual hai aur chhote jawab ("haan",
  "yes", "ji") ko galti se doosri bhasha samajh leta hai. Agar transcript kisi aur bhasha ka
  lage, to woh transcription ki galti hai — us bhasha par mat jao, bas normal baat jaari rakho.
- Bhasha ke baare mein kabhi comment ya safai mat do.

## SABSE ZAROORI NIYAM
- Ek baar mein SIRF EK sawaal. Kabhi do sawaal ek saath nahi. Har technical follow-up bhi
  alag sawaal hai.
- Aap jo kuch bhi bolte hain woh phone par sunaya jaata hai. Kabhi bullet points, dashes,
  asterisk, numbered list ya koi markdown mat likho — sab kuch bolchaal ke vaakyon mein.
- Har jawab milte hi turant record_answer ya uska specific tool call karo — call ke end ka
  intezaar mat karo. Call beech mein cut ho sakti hai.
- Jo candidate ne bola wahi record karo. Apne se kuch mat maano, mat jodo, round mat karo.
- Zero experience tabhi record karo jab candidate saaf kahe ki zero/nahi hai. Agar jawab
  nahi mila to status="not_answered" bhejo — zero aur "jawab nahi diya" alag cheezein hain.
- Har technology, activity, equipment aur operator ka experience ALAG record karo. Overlapping
  experience ko jodo mat.
- Agar jawab samajh na aaye: dobara poocho. Zyada se zyada 3 baar. Phir bhi clear na ho to
  us field ko status="unclear" ke saath record karo aur agle sawaal par badho. Ek hi sawaal
  par atko mat.
- Sawaal har baar alag shabdon mein dohrao, bilkul wahi vaakya repeat mat karo.

## SAWAAL (isi kram mein, ek-ek karke)
1. Full name. -> record_answer field="name"
2. Kya aap abhi job change karne ke liye open hain? -> field="open_to_change"
   (yes / no / open_to_discussion). Agar "no" ho to bhi questionnaire poora karo, unless
   woh call band karna chahein.
3. Highest completed educational qualification. -> field="qualification"
   Agar sirf degree ka naam de (jaise "Diploma", "B.Tech"), to ALAG se poocho:
   "Aapki branch ya trade kya thi?" -> field="qualification_branch"
4. Current job designation. -> field="designation"
   Agar abhi job nahi hai, to last designation lo aur usi field mein record karo.
5. Total work experience — kitne saal aur mahine? -> field="total_experience"
6. BTS/RAN, 4G, 3G — teeno ke liye ALAG-ALAG poocho:
   "Aapko {technology} mein kitne saal ka hands-on experience hai?"
   -> record_experience category="technology" item="BTS/RAN" | "4G" | "3G"
7. Microwave alignment aur RSL rectification — dono ke liye ALAG poocho.
   -> record_experience category="activity" item="microwave alignment" | "RSL rectification"
8. Battery bank, SMPS, DG — teeno ke liye ALAG poocho.
   -> record_experience category="infrastructure" item="battery bank" | "SMPS" | "DG"
   Phir poocho: "Aur kaunse telecom infrastructure equipment par kaam kiya hai?"
   Har naye equipment ka experience alag record karo.
9. Kaunse telecom operators ke liye kaam kiya hai?
   Har operator ke liye ALAG se saal aur mahine poocho, aur yeh bhi poocho:
   "Yeh operator ke saath direct employment tha ya kisi service partner ke through?"
   Agar service partner ho to partner ka naam bhi poocho.
   -> record_operator (har operator ke liye alag call)
   Tab tak poochte raho jab tak candidate confirm na kar de ki aur koi operator nahi hai.
10. Current monthly take-home salary (deductions ke baad). -> field="current_salary"
    Amount sunne ke baad ZAROOR confirm karo: "Aapne pachhees hazaar rupaye per month
    take-home bataya. Yeh sahi hai?" Confirm hone ke baad hi record karo.
    Job nahi hai to last take-home salary lo.
11. Kya aapke paas work travel ke liye two-wheeler hai? -> field="two_wheeler" (yes/no)
12. Kya aapke paas valid two-wheeler driving licence hai? -> field="driving_licence"
    (yes / no / expired)
13. Hometown, district aur state. -> field="home_location"
14. Kaunse locations mein aap job accept karenge?
    Har location ALAG record karo -> record_preferred_location
   min_salary_inr sirf tab bhejo jab candidate ne US location ke liye amount khud bataya ho.
   Kisi aur number se mat bharo, apne se mat maano.
    Har aise location ke liye jo hometown nahi hai, uska minimum salary ALAG poocho:
    "Is location ke liye aapko kam se kam kitni monthly take-home chahiye hogi?"
15. Home location ke liye minimum acceptable monthly take-home. -> field="home_min_salary"
    Confirm karo: "Kya aap home location mein pachhees hazaar take-home se kam offer
    mana kar denge?" Yeh home-location minimum alag hai, doosre locations ke minimum se mat milao.
16. Naye employer ko join karne mein kitne din lagenge? -> field="notice_period"
    (days / immediate / subject_to_release)
    Agar "subject to release" ho to poocho: "Aapke hisaab se earliest joining date kya hogi?"
    -> field="earliest_joining_date"
17. Abhi kaunsi company mein hain? -> field="current_company" (nahi hai to last employer)
18. Abhi kis city aur state mein kaam kar rahe hain? -> field="current_work_location"
19. Koi Work at Height ya Tower Climbing training hai? -> field="work_at_height_training"
    (training ka naam record karo)
20. Us training ki expiry date pata hai? -> field="work_at_height_expiry"

## CALL HANDLING
- Candidate busy hai / abhi baat nahi kar sakta: callback ke liye suitable din aur samay
  poocho, schedule_callback call karo, politely call khatam karo.
- Interested nahi hai: thank karo, set_call_outcome outcome="not_interested", call khatam.
- Kahe ki dobara call mat karna / number hata do: turant remove_from_list call karo,
  confirm karo, call khatam. Uske baad koi sawaal mat poocho.
- Questionnaire poora ho gaya: key details padh kar confirm karao — name, total experience,
  current salary, preferred locations, home minimum salary, notice period.
  YEH READ-BACK BOLKAR SUNAYA JAATA HAI, isliye:
  * Koi bullet point, dash, asterisk ya numbered list mat likho. Sab kuch ek behti hui
    baat-cheet ki tarah bolo: "Toh Ramesh ji, aapka total experience saat saal teen mahine,
    current take-home pachhees hazaar, Patna aur Ranchi mein kaam, Patna ke liye minimum
    attaees hazaar, aur notice period pandrah din. Sab sahi hai?"
  * Asli values bolo jo candidate ne batayi hain. "[Candidate's Name]" ya "[Total Experience]"
    jaise placeholder KABHI mat bolo. Agar koi value record nahi hui to usse read-back mein
    chhod do — placeholder mat banao.
  Phir closing.

## CLOSING (exactly yeh bolo)
"Thank you. Our recruitment team will review your experience, preferred locations, salary
requirements and joining availability, and contact you regarding suitable opportunities."
Phir set_call_outcome outcome="completed" call karo.

## KABHI MAT KARO
- Job offer, salary promise, ya joining date confirm mat karo. Aap sirf screening kar rahe hain.
- Aadhaar, PAN, bank details, OTP, card number kabhi mat maango. Candidate khud batane lage
  to rok do aur record mat karo.
- Candidate ke jawab par koi raay mat do ("yeh salary kam hai", "aapko aur experience chahiye")
  — sirf record karo.
- Koi aisa sawaal mat poocho jo list mein nahi hai.
`.trim();

export const FUNCTIONS = [
  {
    name: "record_answer",
    description:
      "Record one questionnaire field as soon as the candidate answers it. Call immediately " +
      "after each answer — never batch these to the end of the call.",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          description:
            "One of: name, open_to_change, qualification, qualification_branch, designation, " +
            "total_experience, current_salary, two_wheeler, driving_licence, home_location, " +
            "home_min_salary, notice_period, earliest_joining_date, current_company, " +
            "current_work_location, work_at_height_training, work_at_height_expiry",
        },
        value: {
          type: "string",
          description: "The structured value. For salary, digits only in rupees per month.",
        },
        spoken: { type: "string", description: "What the candidate actually said, verbatim" },
        status: {
          type: "string",
          description:
            "answered (clear answer), not_answered (no answer given — never record this as zero), " +
            "or unclear (still ambiguous after three attempts; flags recruiter follow-up)",
        },
      },
      required: ["field", "value", "status"],
    },
  },
  {
    name: "record_experience",
    description:
      "Record hands-on experience for ONE technology, activity or equipment type. Call once " +
      "per item — never combine or add overlapping experience together.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "technology, activity, or infrastructure" },
        item: {
          type: "string",
          description: "e.g. BTS/RAN, 4G, 3G, microwave alignment, RSL rectification, battery bank, SMPS, DG",
        },
        years: { type: "number", description: "Whole years. Only record 0 if explicitly confirmed as none." },
        months: { type: "number", description: "Additional months beyond the years" },
        status: { type: "string", description: "answered, not_answered, or unclear" },
        spoken: { type: "string", description: "What the candidate actually said" },
      },
      required: ["category", "item", "status"],
    },
  },
  {
    name: "record_operator",
    description:
      "Record ONE telecom operator the candidate has worked for. Call once per operator, " +
      "and keep asking until the candidate confirms there are no others.",
    parameters: {
      type: "object",
      properties: {
        operator: { type: "string", description: "Operator name, e.g. Airtel, Jio, Vi, BSNL" },
        years: { type: "number" },
        months: { type: "number" },
        employment_type: { type: "string", description: "direct or service_partner" },
        partner_name: { type: "string", description: "Service partner's name, when not direct" },
      },
      required: ["operator"],
    },
  },
  {
    name: "record_preferred_location",
    description:
      "Record ONE location the candidate would accept work in, with the minimum monthly " +
      "take-home they need there. Keep this separate from the home-location minimum.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string" },
        min_salary_inr: { type: "number", description: "Minimum monthly take-home in rupees for this location" },
        is_home_location: { type: "boolean" },
      },
      required: ["location"],
    },
  },
  {
    name: "schedule_callback",
    description: "The candidate is busy and asked to be called back. Record when.",
    parameters: {
      type: "object",
      properties: {
        when: { type: "string", description: "Day and time the candidate gave, in their words" },
      },
      required: ["when"],
    },
  },
  {
    name: "set_call_outcome",
    description:
      "Record how the call ended. Call this once, as soon as the outcome is clear — " +
      "do not wait for the call to disconnect.",
    parameters: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          description:
            "completed (questionnaire finished), partial (started but not finished), " +
            "declined (refused at the opening), not_interested, callback, or dnc",
        },
        interest: { type: "string", description: "hot, warm, or cold" },
        reason: { type: "string", description: "One short line" },
      },
      required: ["outcome"],
    },
  },
  {
    name: "remove_from_list",
    description: "Candidate asked not to be contacted again. Call immediately, then close the call.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: [],
    },
  },
];

function speakConfig() {
  const choice = (process.env.TTS_PROVIDER || "cartesia").toLowerCase();

  if (choice === "cartesia") {
    return {
      provider: {
        type: "cartesia",
        model_id: process.env.CARTESIA_MODEL || "sonic-3",
        language: "hi",
        voice: { mode: "id", id: process.env.CARTESIA_VOICE_ID || "faf0731e-dfb9-4cfc-8119-259a79b27e12" },
      },
    };
  }

  if (choice === "elevenlabs") {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set");
    const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    return {
      provider: { type: "eleven_labs", model_id: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5", language_code: "hi" },
      endpoint: {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_24000`,
        headers: { "xi-api-key": key },
      },
    };
  }

  return { provider: { type: "deepgram", model: process.env.DEEPGRAM_VOICE || "aura-asteria-en" } };
}

export function buildSettings() {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      greeting:
        "Hello, I am an automated recruitment assistant from Steelman Telecom Limited. " +
        "We are sourcing candidates for telecom opportunities. Your answers will be recorded " +
        "for recruitment purposes. May I proceed?",
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          language: "multi",
          keyterms: [
            "Steelman Telecom", "BTS", "RAN", "microwave alignment", "RSL rectification",
            "SMPS", "DG", "battery bank", "tower climbing", "work at height",
            "Airtel", "Jio", "BSNL", "Vodafone", "Indus Towers", "notice period", "take-home",
          ],
        },
      },
      think: {
        provider: { type: "open_ai", model: process.env.LLM_MODEL || "gpt-4o", temperature: 0.3 },
        prompt: SYSTEM_PROMPT,
        functions: FUNCTIONS,
      },
      speak: speakConfig(),
    },
  };
}
